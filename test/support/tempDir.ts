import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Every directory handed out, so `test/setup-temp-dirs.ts` can remove them when the file that
// asked for them is done. Tracking lives here rather than at the call sites because a helper that
// only creates makes every caller leak by construction — 20 spec files did, and the next one
// written would have joined them (the same reasoning as `test/setup-auto-unmount.ts`).
const handedOut: string[] = [];

// A temp directory spelled the way the production code will resolve it.
//
// Two platforms rewrite the path `mkdtemp` hands back, and a fixture that skips this compares a
// path the code under test never produces:
//
//   macOS   /var/... -> /private/var/...        (the temp dir is itself behind a symlink)
//   Windows C:\Users\RUNNER~1\... -> ...\runneradmin\...   (an 8.3 short component)
//
// `.native` matters on Windows: Node's JS realpathSync leaves the 8.3 component alone while the
// native call expands it, so only the native one agrees with what the server resolves
// (server/git/worktrees.ts says the same, and #1052 is the CI failure that proved it).
export function makeTempDir(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), prefix)));
  handedOut.push(dir);
  return dir;
}

/** The same, for a spec that creates its directory with the promises API. Resolving stays sync —
 *  `fs/promises` has no `.native`, and this is one stat on a directory just created. */
export async function makeTempDirAsync(prefix: string): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  const dir = realpathSync.native(await mkdtemp(path.join(tmpdir(), prefix)));
  handedOut.push(dir);
  return dir;
}

/** Remove every directory handed out so far and forget the ones that went. Registered once per test
 *  file by `setup-temp-dirs.ts`; nothing else should call it.
 *
 *  A removal that fails is swallowed rather than thrown — turning a passing run red during cleanup
 *  would trade a disk-space problem for a flaky suite — but the path is put BACK on the list, so
 *  the next file's sweep tries again. Dropping it on the first failure is how a leak survives a
 *  cleanup that looks like it ran: `EBUSY` and `EPERM` on a directory another process still holds
 *  are transient on Windows, and there would be nothing left to retry with.
 *
 *  `maxRetries` handles the same transience inside the one call, which is cheaper than waiting for
 *  a later file to sweep — and there may not BE a later file. */
export function removeTrackedTempDirs(): void {
  for (const dir of handedOut.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      handedOut.push(dir);
    }
  }
}

/** How many directories are waiting to be removed. Exists so a spec can prove the registry is
 *  actually wired to the caller — see `test/support/tempDir.spec.ts`. */
export const trackedTempDirCount = (): number => handedOut.length;
