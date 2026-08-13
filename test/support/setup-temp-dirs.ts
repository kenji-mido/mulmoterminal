// Every temp directory a spec asked `makeTempDir` for is removed when that spec file finishes.
//
// Without this the suite left 51 directories in $TMPDIR per run, and they accumulate: the machine
// this was found on had 42,000 `mt-*` entries, enough that `ls $TMPDIR` took minutes and readdir
// on it measured 5.4s (#1345). macOS's /var/folders reaper does not necessarily collect them.
//
// `afterAll`, not `afterEach`: several specs create their directory once at module scope and share
// it across the file's tests, so removing after each test would delete it out from under them.
//
// Global rather than per-file for the same reason `setup-auto-unmount.ts` is: the helper's 20
// callers all leaked by construction, and fixing them one at a time leaves the next spec free to
// open the hole again.
// It lives in `test/support/` rather than beside `setup-auto-unmount.ts` because `test/*.ts` is
// included by `tsconfig.test.json`, which extends the APP config and carries no node types — so a
// setup file there importing this registry drags `tempDir.ts` into a project that cannot compile
// `node:fs`. `test/support/**` is already in the server project, where those types exist.
import { afterAll } from "vitest";
import { removeTrackedTempDirs } from "./tempDir";

afterAll(removeTrackedTempDirs);
