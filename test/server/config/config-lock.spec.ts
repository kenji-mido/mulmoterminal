// @vitest-environment node
//
// One machine runs several mulmoterminals (several checkouts, side by side) sharing ONE
// config.json. `writeFileAtomicSync` makes each write all-or-nothing — it says nothing about two
// processes that both READ the old list, each add their own directory, and each write: the second
// rename replaces the first's addition, and a saved directory is gone with no error anywhere.
//
// A saved directory is not cosmetic here: the list is what decides which projects the server
// serves collections for. So the read-modify-write is claimed with a lock, and this is what says
// the lock is real rather than decorative.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from "node:fs";
import { hostname } from "node:os";
import { tmpdir } from "node:os";
import path from "node:path";

import { withConfigLock } from "../../../server/config/config-lock";

const tmp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-config-lock-"));
  return { dir, file: path.join(dir, "config.json"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

/** A read-modify-write of a JSON list — the shape every config writer has. */
const appendUnderLock = (file: string, value: string, onEnter?: () => void) =>
  withConfigLock(file, () => {
    const current: string[] = JSON.parse(readFileSync(file, "utf8"));
    onEnter?.();
    writeFileSync(file, JSON.stringify([...current, value]));
    return value;
  });

describe("withConfigLock", () => {
  // The race is between PROCESSES, so the other party is played by holding the lock file directly
  // — two calls inside one process cannot interleave (the critical section is synchronous), which
  // is why a test that merely starts two of them passes with or without the lock and proves
  // nothing.
  it("waits for the holder, then reads what the holder wrote", async () => {
    const { file, cleanup } = tmp();
    try {
      writeFileSync(file, "[]");
      // "Another mulmoterminal" claims the lock and has not written yet.
      writeFileSync(`${file}.lock`, "");

      let entered = false;
      const ours = appendUnderLock(file, "ours", () => {
        entered = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
      // Still outside: without the lock it would have read `[]` by now and be about to erase the
      // other process's entry.
      expect(entered).toBe(false);

      // The holder finishes its own read-modify-write and releases.
      writeFileSync(file, JSON.stringify(["theirs"]));
      rmSync(`${file}.lock`);

      await ours;
      // Ours read AFTER theirs landed, so both survive — which is the whole point.
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(["theirs", "ours"]);
    } finally {
      cleanup();
    }
  });

  it("releases the lock even when the critical section throws", async () => {
    const { file, cleanup } = tmp();
    try {
      writeFileSync(file, "[]");
      await expect(
        withConfigLock(file, () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(existsSync(`${file}.lock`)).toBe(false);
      // …and the next writer is not shut out by the wreckage.
      await appendUnderLock(file, "after");
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(["after"]);
    } finally {
      cleanup();
    }
  });

  it("leaves no lock file behind on the happy path", async () => {
    const { file, cleanup } = tmp();
    try {
      writeFileSync(file, "[]");
      await appendUnderLock(file, "a");
      expect(existsSync(`${file}.lock`)).toBe(false);
    } finally {
      cleanup();
    }
  });

  // THE CORRECTION AGE ALONE COULD NOT MAKE. An old lock whose owner is still RUNNING is not
  // stale — it belongs to a writer that is merely slow, and taking it lets a second writer into
  // the read-modify-write the first is still inside. That overlap is what this file exists to
  // prevent, so recovery must not reintroduce it.
  it("refuses an old lock whose owner is still alive", async () => {
    const { file, cleanup } = tmp();
    try {
      writeFileSync(file, "[]");
      // This very process is the owner, and it is definitely running.
      writeFileSync(`${file}.lock`, `${hostname()}:${process.pid}:still-here`);
      const longAgo = new Date(Date.now() - 60_000);
      utimesSync(`${file}.lock`, longAgo, longAgo);

      await expect(withConfigLock(file, () => "should not run")).rejects.toThrow(/try again/);
      // Untouched: refusing is the right failure here — a wedged process is something the user
      // can see, a silent lost update is not.
      expect(readFileSync(`${file}.lock`, "utf8")).toBe(`${hostname()}:${process.pid}:still-here`);
    } finally {
      rmSync(`${file}.lock`, { force: true });
      cleanup();
    }
  }, 10_000);

  // A pid from another machine means nothing to `process.kill` — it might match an unrelated
  // local process or miss a live remote one — so a foreign lock is treated as alive.
  it("refuses an old lock written by another host", async () => {
    const { file, cleanup } = tmp();
    try {
      writeFileSync(file, "[]");
      writeFileSync(`${file}.lock`, "some-other-machine:999999:elsewhere");
      const longAgo = new Date(Date.now() - 60_000);
      utimesSync(`${file}.lock`, longAgo, longAgo);
      await expect(withConfigLock(file, () => "should not run")).rejects.toThrow(/try again/);
    } finally {
      rmSync(`${file}.lock`, { force: true });
      cleanup();
    }
  }, 10_000);

  // A crash leaves the lock file behind. Waiting it out forever would wedge the config for the
  // rest of the session, so an old one is broken rather than obeyed.
  it("breaks a stale lock left by a crashed process", async () => {
    const { file, cleanup } = tmp();
    try {
      writeFileSync(file, "[]");
      // Old AND owned by a pid that no longer exists — the two halves together are what makes it
      // safe to take. A pid this high is not in use; if it somehow were, the test would refuse
      // rather than pass wrongly.
      writeFileSync(`${file}.lock`, `${hostname()}:4194303:crashed`);
      const longAgo = new Date(Date.now() - 60_000);
      utimesSync(`${file}.lock`, longAgo, longAgo);

      await appendUnderLock(file, "after-crash");
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(["after-crash"]);
    } finally {
      cleanup();
    }
  });

  // THE ESCAPE HATCH THAT WAS WRONG. An earlier version ran the critical section anyway when the
  // lock could not be taken, reasoning that losing the user's action beats a narrow race. Both
  // halves were false: the action is not lost (the caller retries — a launched directory is
  // recorded again on the next launch), and "a narrow race" is exactly this bug — the writer
  // would read the old config while the holder is mid-write and overwrite it. A visible "try
  // again" beats a rare silent deletion of someone else's data.
  it("REFUSES rather than running without the lock", async () => {
    const { file, cleanup } = tmp();
    try {
      writeFileSync(file, "[]");
      writeFileSync(`${file}.lock`, ""); // a live holder, kept fresh below
      let entered = false;
      const keepFresh = setInterval(() => {
        try {
          const now = new Date();
          utimesSync(`${file}.lock`, now, now);
        } catch {
          // gone — the test is finishing
        }
      }, 200);
      try {
        await expect(withConfigLock(file, () => (entered = true))).rejects.toThrow(/try again/);
      } finally {
        clearInterval(keepFresh);
      }
      expect(entered).toBe(false);
      // And nothing was written: the file is exactly as the holder left it.
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([]);
    } finally {
      cleanup();
    }
  }, 10_000);

  // ~/.mulmoterminal does not exist on a first-ever write, and a failed claim there is not
  // contention. Treating it as such made a fresh install wait out the timeout and then refuse to
  // save anything at all.
  it("creates the config directory rather than reading a missing one as contention", async () => {
    const { dir, cleanup } = tmp();
    try {
      const nested = path.join(dir, "never-created", "config.json");
      const started = Date.now();
      await withConfigLock(nested, () => writeFileSync(nested, '["made it"]'));
      expect(JSON.parse(readFileSync(nested, "utf8"))).toEqual(["made it"]);
      expect(Date.now() - started).toBeLessThan(1_000); // i.e. it did not wait anything out
    } finally {
      cleanup();
    }
  });

  // Stale-breaking is what stops a crash from wedging the config, and its cost is that a lock can
  // be taken from a LIVE holder whose critical section ran long. What must not follow is a
  // cascade: the original owner reaching `finally` and freeing the NEW holder's lock, so a third
  // writer walks in while the second is inside. The claim carries a token and the release checks
  // it, so the loser of a theft removes nothing.
  it("does not release a lock that was reclaimed while it was held", async () => {
    const { file, cleanup } = tmp();
    try {
      writeFileSync(file, "[]");
      let released: string | null = null;
      await withConfigLock(file, () => {
        // Somebody breaks our (apparently stale) lock and claims it.
        rmSync(`${file}.lock`);
        writeFileSync(`${file}.lock`, "the-new-owner");
      });
      released = existsSync(`${file}.lock`) ? readFileSync(`${file}.lock`, "utf8") : null;
      // The new owner's lock is still there — we did not free somebody else's claim.
      expect(released).toBe("the-new-owner");
    } finally {
      rmSync(`${file}.lock`, { force: true });
      cleanup();
    }
  });

  it("writes an owner token, not an empty file", async () => {
    const { file, cleanup } = tmp();
    try {
      writeFileSync(file, "[]");
      let seen = "";
      await withConfigLock(file, () => {
        seen = readFileSync(`${file}.lock`, "utf8");
      });
      // host + pid + a unique part. The host is what makes the liveness check honest on a network
      // share (another machine's pid means nothing here); the unique part is because one process
      // can hold the lock twice in sequence, and the second claim must not be releasable by the
      // first.
      const [host, pid, unique] = seen.split(":");
      expect(host).toBe(hostname());
      expect(Number(pid)).toBe(process.pid);
      expect(unique?.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  // A critical section that returns a promise must be awaited INSIDE the lock. Releasing when the
  // promise is merely created would run the section outside the protection it asked for — worse
  // than not locking, because it looks locked.
  it("holds the lock until an async critical section finishes", async () => {
    const { file, cleanup } = tmp();
    try {
      writeFileSync(file, "[]");
      let lockedDuring: string | null = null;
      const result = await withConfigLock(file, async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        lockedDuring = existsSync(`${file}.lock`) ? "held" : "released";
        return "done";
      });
      expect(lockedDuring).toBe("held");
      expect(result).toBe("done");
      expect(existsSync(`${file}.lock`)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("returns what the critical section returned", async () => {
    const { file, cleanup } = tmp();
    try {
      writeFileSync(file, "[]");
      expect(await withConfigLock(file, () => 42)).toBe(42);
    } finally {
      cleanup();
    }
  });
});
