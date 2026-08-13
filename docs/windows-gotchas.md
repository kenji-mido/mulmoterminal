# Windows gotchas

Traps this codebase has actually hit on Windows, each with where the fix lives. Read before
debugging a Windows-only failure, and before writing a path comparison, a spawn, or an
`fs.watch` that will run there.

`windows-daily.yaml` is the only job that executes any of this — it runs daily and on `main`,
not on pull requests. Dispatch it on a branch with
`gh workflow run windows-daily.yaml --ref <branch>`.

## Spawning

**`CreateProcessW` runs PE images only.** A `.cmd`, a `.bat`, and an extensionless shell shim
cannot be executed directly — they need `cmd.exe`. An npm-global install leaves exactly those
(`claude`, `claude.cmd`, `claude.ps1`) and no `.exe`.

**node-pty's PATH lookup matches file names exactly.** `src/win/path_util.cc get_shell_path`
never appends an executable extension, so a bare `claude` misses `claude.exe` and the spawn
fails with `File not found: ` — with *nothing* after the colon, because the path it failed to
find is the empty string. Two further bugs live in the same function: the PATH splitter drops
the segment after the final `;`, and a name that exists relative to the cwd returns empty.

**The existence gate and the actual launch resolve differently.** node-pty checks the file
exists via its own lookup, then calls `CreateProcessW(nullptr, cmdline, …)`, which does its
own PATH search and appends `.exe`. A command can therefore pass the gate on one file and run
a different one — which is how an extensionless shim "works" by accident.

→ `server/infra/resolve-bin.ts` resolves the name before node-pty sees it, and
`server/infra/cmd-escape.ts` wraps a batch target in `cmd.exe /d /s /c`. Both are reached from
the single `spawnPty()` in `server/session/pty-spawn.ts` (#794, #798).

**cmd.exe re-parses the command line before the child's CRT does.** `\"` — the CRT's escape,
and what node-pty's own `argsToCommandLine` emits — does not escape a quote for cmd; it *ends*
the quoted run, after which a `&` in the same argument is a command separator. Quote every
argument, double internal quotes (`""`), double a trailing backslash run, and reject NUL/CR/LF.
`%VAR%` is still expanded inside double quotes and cmd has no escape for it. Rust hit this in
CVE-2024-24576; Node answered CVE-2024-27980 by refusing to spawn `.cmd` without a shell.

## Paths

**`path.resolve` drive-qualifies.** `path.resolve("\\home\\u")` becomes `C:\home\u`. Resolving
one side of a comparison and not the other silently stops matching — that was #802.

**Comparison is case-insensitive.** NTFS and the Win32 API treat `C:\Users\u` and `c:\users\u`
as one directory; `String.startsWith` and `===` do not. macOS is *usually* case-insensitive
too, but a case-sensitive APFS volume is a supported setup, so folding there would widen a
containment guard on a guess.

**A prefix is not containment.** `…\project-old` starts with `…\project` as a string. The
separator is what makes the check a boundary.

→ `server/infra/path-within.ts` — `isWithin` / `isStrictlyWithin` / `isSamePath`. Use these
rather than hand-rolling `target.startsWith(base + path.sep)`; several callers are security
boundaries, and the lexical answer still needs a realpath pass for symlinks.

## Tests that handle paths

**Build the EXPECTED path with `path.resolve` too, never as a POSIX literal.** A rule that
resolves with the platform's own `path` produces `<drive>:\shared-lib` on Windows (drive-qualified,
per the section above — the CI failure read `D:\shared-lib`) and `/shared-lib` elsewhere, so an
expectation written as `"/shared-lib"` matches on the developer's machine and nowhere else. `yarn test` stays green locally and the daily Windows job goes red — #912's
`resolveAddDirs` spec cost exactly that.

**A stubbed predicate that compares paths has the same problem, and it fails silently.** That
spec's EACCES case asked `p === "/denied"`, which on Windows never matched — so nothing threw,
both entries survived, and the property under test ("a throwing check drops only its own
entry") was not being tested there at all. A path-comparing stub is a path comparison: resolve
its operand as well.

```ts
const BASE = path.resolve("/repo");            // C:\repo on Windows, /repo elsewhere
const SIBLING = path.resolve(BASE, "../lib");  // the expectation, computed the same way
```

→ `test/server/config/add-dirs.spec.ts` for the shape.

**A double that routes on a file NAME is a path comparison too.** The specs that mock `node:fs`
pick a log apart by basename, and `String(file).split("/").pop()` returns the whole path on
Windows — so a read falls through to `""` and a recorded write filters out to nothing. Neither
throws: the spec reads empty logs and reports the feature as broken. #1189 and #1196 each shipped
one, and Windows daily went red on 12 consecutive runs before it was traced (#1212).

Use `mockedFileName()` from `test/support/mockFsPath.ts` (`split(/[/\\]/)`). Not `path.basename` —
correct at runtime, but on POSIX it leaves `\` alone, so the Windows case cannot be asserted on the
machine that runs the suite. Not `endsWith` either: `unplaced-sessions.json` ends with
`placed-sessions.json`, so a suffix match reads the two logs as one.

**Verify on the real runner before merging**, with the dispatch at the top of this file. Local
`yarn test` on macOS/Linux cannot see any of this — the whole class only appears where the
separator and the drive letter differ.

## Filesystem watching

**`fs.watch` on an 8.3 short path is unreliable, and can abort the process.** `os.tmpdir()`
returns `C:\Users\RUNNER~1\…` on a GitHub runner; expand it with **`realpathSync.native`**
before watching — plain `realpathSync` is the JS implementation and hands the short name straight
back, which is how a spec that already called it still compared `RUNNER~1` against git's
`runneradmin` (Windows daily, 2.5.1). Even then Windows gives no delivery guarantee — the reload case in
`test/scripts/dev-server.spec.ts` is skipped there rather than left to flake.

## Environment

**`process.env` is case-insensitive, a copy of it is not.** Windows spells it `Path` and
`ComSpec`; `Object.entries(process.env)` keeps that casing, so `copy.PATH` is `undefined`.
→ `envValue()` in `server/infra/pty-env.ts`.
