// @vitest-environment node
import { describe, it, expect } from "vitest";
import { writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir";
import { backupDirFor, expiredBackups, storeBackup, backupCurrentFile, BACKUP_GENERATIONS } from "../../../server/files/backup-store";

const tmp = () => makeTempDir("mt-backup-");
const backupsIn = (dir: string) =>
  readdirSync(dir)
    .filter((n) => n.endsWith(".bak"))
    .sort();

// Resolved, not POSIX literals: on Windows an absolute path is drive-qualified, so an
// expectation written as "/backups" only agrees on the developer's machine.
const ROOT = path.resolve("/backups");
const FILE = path.resolve("/proj/a.md");
// Built by hand rather than with path.join, which would normalize away the `..` this is about.
const MESSY_FILE = [path.dirname(FILE), "sub", "..", path.basename(FILE)].join(path.sep);

describe("backupDirFor", () => {
  it("gives each file its own stable directory", () => {
    expect(backupDirFor(FILE, ROOT)).toBe(backupDirFor(FILE, ROOT));
    expect(backupDirFor(FILE, ROOT)).not.toBe(backupDirFor(path.resolve("/proj/b.md"), ROOT));
    // Same file reached by a messier path is the same file.
    expect(backupDirFor(MESSY_FILE, ROOT)).toBe(backupDirFor(FILE, ROOT));
  });

  // A path can't BE a directory name: separators, case folding and length limits all break it.
  it("names it with a hash, not the path", () => {
    const dir = backupDirFor(FILE, ROOT);
    expect(path.dirname(dir)).toBe(ROOT);
    expect(path.basename(dir)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("expiredBackups", () => {
  const names = ["000000000000001-a.md.bak", "000000000000002-a.md.bak", "000000000000003-a.md.bak", "000000000000004-a.md.bak"];

  it("drops the oldest beyond the limit, keeping the newest", () => {
    expect(expiredBackups(names)).toEqual(["000000000000001-a.md.bak"]);
    expect(expiredBackups(names, 2)).toEqual(["000000000000002-a.md.bak", "000000000000001-a.md.bak"]);
  });

  it("keeps everything while under the limit, and never touches non-backups", () => {
    expect(expiredBackups(names.slice(0, BACKUP_GENERATIONS))).toEqual([]);
    expect(expiredBackups([...names, "source.txt"])).not.toContain("source.txt");
  });
});

describe("storeBackup", () => {
  const withStore = (run: (file: string, root: string, dir: string) => void) => {
    const proj = tmp();
    const root = tmp();
    const file = path.join(proj, "a.md");
    try {
      run(file, root, backupDirFor(file, root));
    } finally {
      rmSync(proj, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  };

  it("keeps only the newest generations, oldest first out", () => {
    withStore((file, root, dir) => {
      ["one", "two", "three", "four"].forEach((text, i) => storeBackup(file, text, root, 1000 + i));
      const kept = backupsIn(dir).map((n) => readFileSync(path.join(dir, n), "utf8"));
      expect(kept).toEqual(["two", "three", "four"]);
    });
  });

  // Re-opening a file calls through here. Rotating identical copies would push the real
  // history out three opens later, which is exactly when it is wanted.
  it("does not rotate a generation when the content is unchanged", () => {
    withStore((file, root, dir) => {
      expect(storeBackup(file, "same", root, 1000)).not.toBeNull();
      expect(storeBackup(file, "same", root, 2000)).toBeNull();
      expect(backupsIn(dir)).toHaveLength(1);

      expect(storeBackup(file, "different", root, 3000)).not.toBeNull();
      expect(backupsIn(dir)).toHaveLength(2);
    });
  });

  // Saving on the user's behalf means bursts. A bare timestamp had the second write of a
  // millisecond replace the first, quietly costing a generation exactly when churn makes them
  // worth having.
  it("keeps both generations written within the same millisecond", () => {
    withStore((file, root, dir) => {
      expect(storeBackup(file, "first", root, 1000)).not.toBeNull();
      expect(storeBackup(file, "second", root, 1000)).not.toBeNull();
      const kept = backupsIn(dir).map((n) => readFileSync(path.join(dir, n), "utf8"));
      expect(kept).toEqual(["first", "second"]); // still in the order they were written
    });
  });

  // The directory is named by a hash, so nothing in it says which file it belongs to.
  it("records the source path so the store can be read by a human", () => {
    withStore((file, root, dir) => {
      storeBackup(file, "one", root, 1000);
      expect(readFileSync(path.join(dir, "source.txt"), "utf8")).toBe(file);
    });
  });

  // Refusing to save because a BACKUP failed would be exactly backwards.
  it("reports failure instead of throwing when the store is unusable", () => {
    const proj = tmp();
    const file = path.join(proj, "a.md");
    const blocked = path.join(proj, "not-a-dir");
    writeFileSync(blocked, "in the way");
    expect(storeBackup(file, "one", blocked)).toBeNull();
    rmSync(proj, { recursive: true, force: true });
  });
});

describe("backupCurrentFile", () => {
  it("banks what is on disk right now", () => {
    const proj = tmp();
    const root = tmp();
    const file = path.join(proj, "a.md");
    writeFileSync(file, "on disk");

    const stored = backupCurrentFile(file, root, 1000);
    expect(stored).not.toBeNull();
    expect(readFileSync(stored as string, "utf8")).toBe("on disk");

    rmSync(proj, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  it("has nothing to bank for a file that isn't there yet", () => {
    const root = tmp();
    const missing = path.join(tmp(), "nope.md");
    expect(backupCurrentFile(missing, root)).toBeNull();
    expect(existsSync(backupDirFor(missing, root))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});
