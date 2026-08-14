// A spawned pty must give back every fd it took. node-pty 1.1.0 kept two per spawn on macOS — an
// unused `/dev/ptmx` its own cleanup loop skipped, and the slave the parent never closed — so a
// server that had started a few hundred sessions could no longer open a pty at all, and the only
// cure was restarting it (#1595).
//
// Both halves are counted, because they were two separate mistakes in `pty_posix_spawn` and either
// could come back alone. This counts real fds rather than asserting a version, because the question
// is whether the CURRENT node-pty still leaks, and that has to keep being true across the next
// upgrade. macOS only: the bug lives in that platform's spawn, and `lsof` is how the count is taken.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import type { IPty } from "node-pty";
import { spawnPty } from "../../../server/session/pty-spawn.js";

// Named absolutely: this is macOS's own lsof, and a PATH lookup would let anything earlier on
// PATH answer the question instead.
const LSOF = "/usr/sbin/lsof";
const SPAWNS = 8;
// node-pty closes the master 200ms after exit, so the count is not final the moment onExit fires.
const SETTLE_DEADLINE_MS = 5_000;
const SETTLE_POLL_MS = 100;

/** The two fd classes a pty spawn takes out, counted separately so a regression in either one
 *  fails on its own. `slave` spans both spellings of the same descriptor: macOS prints it as
 *  `/dev/ttysNNN` while the child is alive and as `(revoked)` once the child has exited, so a
 *  parent that kept it shows up under the second. */
interface PtyFds {
  ptmx: number;
  slave: number;
}

const countFds = (out: string): PtyFds => {
  const lines = out.split("\n");
  return {
    ptmx: lines.filter((line) => line.includes("/dev/ptmx")).length,
    slave: lines.filter((line) => /\/dev\/ttys\d+/.test(line) || line.includes("(revoked)")).length,
  };
};

/** What this process holds now, or null where lsof cannot answer. */
const ptyFds = (): PtyFds | null => {
  try {
    return countFds(execFileSync(LSOF, ["-p", String(process.pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch (err) {
    // lsof exits non-zero when any one fd is unreadable, having already printed the rest.
    const partial = err instanceof Error && "stdout" in err ? err.stdout : null;
    return typeof partial === "string" && partial.length > 0 ? countFds(partial) : null;
  }
};

const exitOf = (pty: IPty): Promise<void> => new Promise((resolve) => pty.onExit(() => resolve()));

const isBackTo = (baseline: PtyFds, now: PtyFds): boolean => now.ptmx <= baseline.ptmx && now.slave <= baseline.slave;

const settleTo = async (baseline: PtyFds): Promise<PtyFds> => {
  const deadline = Date.now() + SETTLE_DEADLINE_MS;
  for (;;) {
    const now = ptyFds() ?? baseline;
    if (isBackTo(baseline, now) || Date.now() > deadline) return now;
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
};

describe.skipIf(process.platform !== "darwin")("spawnPty fd accounting", () => {
  it("holds neither the ptmx nor the slave fd once the pty has been killed", async (ctx) => {
    const before = ptyFds();
    if (before === null) return ctx.skip();

    for (let i = 0; i < SPAWNS; i++) {
      const pty = spawnPty("/bin/cat", [], "/tmp");
      pty.onData(() => {});
      const exited = exitOf(pty);
      pty.kill();
      await exited;
    }

    expect(await settleTo(before)).toEqual(before);
  });
});
