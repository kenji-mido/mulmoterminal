# fix #1148 — an initialPrompt is typed but never submitted on an `esc-cr` host

## Symptom

With `terminalSubmit: "esc-cr"` (the host's Claude submits on ESC+CR, i.e. Alt/Option+Enter),
spawning a session with an `initialPrompt` leaves that prompt sitting in the input box. Every
path that seeds a session is affected: the Settings / GridView Skill launch buttons (which pass
`skillSeed(slug, "claude")` = `/<slug>`), collection / custom-view chat, and any other spawn that
carries an `initialPrompt`. A `draft` is unaffected — it deliberately sends no Enter.

## Root cause

Two independent defects on the same path, and the reported repro needs BOTH fixed.

**1. The submit byte is hardcoded.** `server/session/draft-injection.ts` writes a bare `"\r"`
after the paste. On an `esc-cr` host `\r` is the NEWLINE, so the prompt can never submit — the
session is structurally unable to send its first turn. #772 introduced `terminalSubmit` and wired
the browser key handler (`src/composables/useTerminalConnections.ts`) and the phone remote-view
submit (`server/backends/remoteHost/terminalInput.ts`); this third server-side auto-submit was
missed, and it is the only one that never reads `submitSequenceForAgent`.

**2. No completion-menu guard.** Claude Code holds a completion menu open while the cursor sits
at the end of a `/command` or `@path`, and an open menu eats the submit (#1142). The skill seed
is exactly `/<slug>`, so fixing the submit bytes alone still leaves the reported repro dead — B2
below. The `@path` half of this hits the DEFAULT `cr` host too (D1), so this is not an `esc-cr`
bug: any `initialPrompt` ending in an `@path` fails to submit today, on every host.

## Measured (Claude Code 2.1.220, real TUI in tmux, bytes sent with `tmux send-keys -H`)

Each row is the exact shape this code path emits: bracketed paste in one write, then the submit
byte(s) in a SEPARATE write `DRAFT_SUBMIT_MS` (150 ms) later. The `esc-cr` host is a throwaway
`CLAUDE_CONFIG_DIR` whose `keybindings.json` binds `enter: chat:newline` / `alt+enter: chat:submit`.

| # | host | sent | result |
| --- | --- | --- | --- |
| B1 | `esc-cr` | paste `/help` → `CR` (**today's code**) | **not submitted** — the CR landed as a newline |
| B2 | `esc-cr` | paste `/help` → `ESC CR` (submit-byte fix only) | **not submitted** — menu open, it ate the ESC |
| B3 | `esc-cr` | paste `/help ` → `ESC CR` (**the fix**) | submitted — help overlay opened |
| B4 | `esc-cr` | paste `ping test one ` → `ESC CR` | submitted — ordinary text needs no menu guard, and is not hurt by one |
| B5 | `esc-cr` | paste 1520 chars → `ESC CR` at 150 ms | submitted intact — `DRAFT_SUBMIT_MS` holds for ESC+CR and for a long paste |
| C1 | `cr` (default) | paste `/help ` → `CR` | submitted — the trailing space costs the default host nothing |
| D1 | `cr` (default) | paste `look at @notes.txt` → `CR` (**today's code**) | **not submitted** — the file picker took the CR |
| D2 | `cr` (default) | paste `look at @notes.txt ` → `CR` | submitted, and the file was read |

B5 is the timing question the issue asked to settle: ESC+CR is two bytes rather than one and the
paste is asynchronous, but the existing 150 ms gap is enough — no new constant.

Then the FIXED code itself, against the same live TUIs — `attachDraftInjection` run for real with
its `term.write` piped into the tmux session, so the bytes are the ones this branch produces:

| # | host | initialPrompt | wrote | result |
| --- | --- | --- | --- | --- |
| E1 | `esc-cr` | `/help` | `\e[200~/help \e[201~` then `\e\r` | submitted — help overlay opened |
| E2 | `cr` (default) | `look at @notes.txt` | `\e[200~look at @notes.txt \e[201~` then `\r` | submitted, file read |

E1 is B1's repro, now working; E2 is D1's, on a host `terminalSubmit` never touched.

## Fix

`server/session/draft-injection.ts`, `attachDraftInjection` only:

- Submit with the configured sequence instead of `"\r"`, resolved **at submit time** so a config
  edit needs no restart — the same live read as `server/index.ts:712`.
- End an auto-run line with `submittableLineForAgent` (inside the paste, where the TUI reads it
  as text rather than a keystroke an open menu could take), so no menu holds the submit.

The submit sequence arrives as an injected thunk from `server/session/spawn-claude.ts`, which
already imports `getTerminalSubmit` from `config/config-routes.js` and does the same
`submitSequenceForAgent(entry.agent, …)` lookup `index.ts` does for the phone. Importing
`config-routes.js` into `draft-injection.ts` instead would run `loadAppConfig()` at import time,
so a unit test would read the developer's real `~/.mulmoterminal/config.json` and pass or fail by
machine. `entry.agent` still decides both behaviours, so a shell/codex entry keeps plain CR and
byte-exact text.

`entry` is narrowed to what typing actually needs (`agent` + `term.write`) so the spec can build a
target without faking all of `IPty`, and without an `as` cast.

## A fourth site, found by sweeping the rule (not in the issue)

`server/agents/rate-limit-probe.ts` types `PROBE_PROMPT` into a real `claude` PTY and submitted
with a hardcoded `"\r"` too. On an `esc-cr` host the probe's question is therefore never asked: it
can only time out after 90 s, so the rate-limit gauge never refreshes and nothing on screen says
why. Same fix, same injected thunk (`ProbeDeps.submitSequence`, supplied from `server/index.ts`
where the other live config reads already are).

No menu guard there: `PROBE_PROMPT` is a constant we own, with no `/` or `@` token — and it is
also the only thing that identifies a pre-`--session-id` probe transcript (#1010), so its bytes
are deliberately left alone.

## Deliberately out of scope

- `attachCodexAutoRun` keeps its plain `\r`, now with a line saying why: `terminalSubmit`
  describes Claude Code's keymap, and `submitSequenceForAgent` gives every other agent CR. Its
  text is not menu-guarded either — `submittableLineForAgent` is Claude-only by measurement
  (#1142 S2), and codex's completion behaviour has not been measured.
- A `draft` gets neither the guard nor a submit: the user reviews it, and their own Enter is a
  keystroke they can retry once they see the menu. Same rule as `insertText` / `pasteText` (#1142).
- `DRAFT_SUBMIT_MS` is unchanged (B5).

## Tests

`test/server/session/draft-injection.spec.ts` (new), with fake timers:

- an `initialPrompt` submits with `\x1b\r` in `esc-cr` and `\r` in `cr`, as a SEPARATE write
  `DRAFT_SUBMIT_MS` after the paste;
- the mode is read when the submit fires, not when the session is attached (a config edit between
  the two takes effect);
- the auto-run line carries the guard space INSIDE the paste, which is opened once and closed once;
- a `draft` writes no submit at all and keeps its text byte-exact (no guard space);
- a non-Claude entry keeps plain CR and byte-exact text (the `entry.agent` scoping);
- the readiness marker types after the settle, and the fallback still fires when it never paints.
