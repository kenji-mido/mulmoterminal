# #1653 — green the Windows daily job

## What was wrong

`windows-daily` failed every run from 2026-08-09T15:07Z. Five specs, three causes, no product bug
among them. The interesting part is the **accumulation**: it started as one spec and grew to five,
because a job that is already red cannot report the next breakage.

| when | failing specs |
|---|---|
| 08-09 15:07 | `backends/system-tasks` |
| 08-09 17:48 | + `backends/collectionWatchers` |
| 08-10 00:13 | + `config/cwd-preset-routes` |
| later | + `backends/ensureAid`, + `session/pty-spawn-win` |

## Cause 1 — POSIX literals as expectations (3 specs)

This is the failure class `docs/windows-gotchas.md` already describes under "Tests that handle
paths". The code canonicalises with the platform's own `path`, which drive-qualifies on Windows,
so `"/srv/mag2"` as an expectation matches on a developer's machine and nowhere else:

```
expected [ 'D:\srv\mag2', 'D:\srv\site', 'D:\srv\ws' ] to deeply equal [ '/srv/mag2', … ]
```

Fixed by putting **both** the inputs and the expectations through `path.resolve`, per the doc's
own shape. The "two spellings of one directory" cases keep their intent — they are now a trailing
`path.sep` and a `.` segment appended to the resolved path, rather than POSIX text.

## Cause 2 — `ensureAid` asserts a POSIX permission bit

`chmodSync(appJson(), 0o600)` then `expect(mode & 0o777).toBe(0o600)`. NTFS has no POSIX bits, so
chmod moves the read-only attribute and nothing else; the mode reads back `0o666`.

The point worth recording: **the setup cannot establish the precondition there**, so this was not
a test that failed on Windows — it was a test that could not run on Windows while looking as
though it did. Skipped with `it.skipIf(process.platform === "win32")`, the way
`session-settings.spec.ts` already skips its owner-only check.

## Cause 3 — `pty-spawn-win` reads `pid` synchronously

Not a broken spawn, and worth being explicit because the failure reads like one. node-pty fills
`pid` in asynchronously on Windows, from the conout worker's ready callback. Its own source says
so (`node_modules/node-pty/lib/windowsTerminal.js`):

```js
// Not available until `ready` event emitted.
this._pid = this._agent.innerPid;
...
this._socket.on('ready_datapipe', function () {
  // Update pid now that the agent has connected
  this._pid = this._agent.innerPid;
```

So `term.pid` is 0 the moment `spawnPty` returns, however well the spawn went. It read `>0` until
node-pty `1.2.0-beta.15` (which arrived with #1595's fd-leak fix) and `0` after.

Two things say the spawn itself is fine: all **18** `.cmd` spawns in the same file pass, and this
test's own remaining assertions — the child's exit code and the `mt-probe ok` it writes — prove a
real process far better than a number does. The `pid` assertion is dropped rather than made
asynchronous; it was the weakest of the three.

## How this was verified

Local `yarn test` **cannot** see any of this — the whole class only appears where the separator
and the drive letter differ. So the branch was pushed and `windows-daily` dispatched against it:

```sh
gh workflow run windows-daily.yaml --ref fix/windows-daily-red
```

That run is the evidence, not the local suite. Local checks (9852 tests, typecheck) only confirm
nothing was broken for the other platforms.

## Not fixed here

A red job hiding the next breakage is the reason one spec became five. Whether `windows-daily`
should announce its red→green transitions somewhere a human reads is a separate question, left in
the issue rather than answered here.
