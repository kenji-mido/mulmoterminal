// A temporary directory that `os.homedir()` answers with, for a spec that exercises code reading
// ~/.claude or ~/.mulmoterminal without touching the developer's own home.
//
// BOTH variables are set, because **os.homedir() reads USERPROFILE on Windows and HOME everywhere
// else**. Stubbing only HOME leaves a Windows run pointed at the runner's real home: the code
// writes there while the spec asserts against the scratch directory, so a path-checking test fails
// and — worse — a test that only reads the module's own answers PASSES while quietly polluting the
// real home. That is exactly how four specs went green on macOS and red on Windows (#1396), and
// #1079 was the same trap in test/bin/instances.spec.ts.
//
// Written once here rather than copied into each spec, and it VERIFIES rather than assumes: if
// os.homedir() does not answer the scratch directory, the spec fails at the call with the reason,
// instead of later with an empty directory that reads like a missing feature.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ScratchHome {
  /** The directory `os.homedir()` now answers with. */
  readonly path: string;
  /** Put the environment back and delete the directory. */
  release(): void;
}

export function takeScratchHome(prefix: string): ScratchHome {
  const home = mkdtempSync(path.join(os.tmpdir(), prefix));
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;

  // Written out rather than looped over the two names: a computed `delete process.env[name]` is
  // what the lint rule is about, and there are exactly two.
  const restore = (): void => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
  };

  // Asked, not assumed: the whole point is that "which variable moves os.homedir()" is
  // platform-specific, so the answer is checked on the platform actually running. A raw string
  // comparison is right here — os.homedir() hands back the variable verbatim, whichever one it read.
  if (os.homedir() !== home) {
    restore();
    rmSync(home, { recursive: true, force: true });
    throw new Error(`os.homedir() still answers ${os.homedir()} after HOME/USERPROFILE were pointed at ${home}`);
  }

  return {
    path: home,
    release() {
      restore();
      rmSync(home, { recursive: true, force: true });
    },
  };
}
