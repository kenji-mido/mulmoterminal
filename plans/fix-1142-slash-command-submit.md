# fix #1142 — a slash command sent from the phone never submits on an `esc-cr` host

## Symptom

With `terminalSubmit: "esc-cr"` (the host's Claude submits on ESC+CR, i.e. Alt/Option+Enter),
sending `/sync-repos` from the phone leaves `/sync-repos` sitting in the host's input box with
the command-completion menu open. Ordinary sentences submit fine through the same path;
resending changes nothing. That kills the whole point of `listSkills` — a phone skill list whose
entries reach the session as `/<slug>` — for exactly the hosts `terminalSubmit` exists to serve.

## Root cause

Claude Code keeps a **completion menu** open while the cursor sits at the end of a completion
token (`/command`, `@path`). While that menu is open, the TUI runs its **`Autocomplete`
keybinding context** — which binds `escape` to `autocomplete:dismiss` — so the `ESC CR` that
submits in `esc-cr` mode is not seen as one Alt+Enter key: the ESC is eaten by the menu. A plain
CR is unaffected, which is why default hosts never saw this.

`sanitizeTerminalInput`'s `.trim()` is what makes it unfixable from the phone: a trailing space
closes the menu, but the server strips it before the paste, so no text the client sends can
carry one.

### Why `sanitizeTerminalInput` trims (it must keep doing so)

`text.replace(CONTROL_BYTES_RE, " ").replace(/\s+/g, " ").trim()` — the trim is not cosmetic:

1. Control bytes are replaced with a **space**, not removed, so `a\nb` cannot become `ab`.
2. That manufactures whitespace the user never typed: `"\x03"` → `" "`, `"\r\n"` → `" "`.
3. `.trim()` is what turns those into `""`, which is what makes the caller's
   `if (!safe) throw new Error("text is required")` guard work. Without it, control-only input
   is truthy and the host submits an **empty turn** (or a blank shell line). A leading space
   would also be typed into the box for real (`HISTCONTROL=ignorespace` in a shell).

So the fix must not touch the sanitizer — #781 also settled the policy that phone text stays
untrusted and the sanitizer does not get loosened. The trailing space is added **after** the
emptiness decision, by the layer that already owns the framing and the submit bytes.

## Measured (Claude Code 2.1.220, real TUI in tmux, bytes sent with `tmux send-keys -H`)

| # | sent | result |
| --- | --- | --- |
| M1 | paste `/help` → `CR` | submitted (default binding — the untouched case) |
| M3 | paste `/help` → `ESC CR` | **not submitted**; menu ate the ESC, the CR landed as a newline |
| M2 | paste `/help ` → `CR` | menu **closed** on the paste, submitted, command ran |
| M5 | paste `look at @common/terminalSubmit.ts` | file picker **open** — same trap, not just `/` |
| M6 | paste `look at @common/terminalSubmit.ts ` | picker **closed** |
| M7 | paste `look at @…terminalSubmit.ts` → `CR` | **not submitted** — the picker takes the CR itself |
| M8 | paste `look at @…terminalSubmit.ts ` → `CR` | submitted (turn started) |
| R1 | **raw-typed** `/help` → `ESC CR` | not submitted — the browser UI's own path has this too |
| R2 | **raw-typed** `/help ` → `CR` | submitted |
| S1 | shell (zsh): paste `echo hi ` → `CR` | ran `echo hi` — a trailing space is inert here |
| S2 | shell (zsh): `echo foo\` → `CR` vs `echo foo\ ` → `CR` | **continuation prompt** vs **runs, prints `foo`** |

M5/M6 are why the fix is not "when the text starts with `/`": a false negative silently
reproduces a dead end, so the rule must not try to enumerate Claude Code's trigger characters.

M7/M8 are why it is not scoped to `esc-cr` either. The `@path` half of the family breaks on the
DEFAULT mapping too — one plain CR is consumed by the file picker — so a guard that only ran for
ESC-prefixed submits would leave every default host with the same dead end.

S2 is why it IS scoped to Claude sessions (Codex's review of this PR raised it). For a shell the
trailing space is real input: a line ending in `\` escapes the newline and waits for more, and with
a space appended it is an escaped space that runs instead. Different execution, same bytes from us.

## Fix

One shared helper next to the submit-byte mapping both sides already read, applied at every
place that types text and then submits it **for** the user — and, like that mapping, scoped to
Claude sessions:

```ts
// common/terminalSubmit.ts
export const submittableLine = (text: string): string => (/\S$/.test(text) ? `${text} ` : text);
export const submittableLineForAgent = (agent: string | undefined, text: string): string =>
  agent === "claude" ? submittableLine(text) : text;
```

- `server/backends/remoteHost/terminalInput.ts` — inside the bracketed paste, after the
  emptiness check. Submit bytes untouched. The agent arrives through a new `sessionAgent` dep,
  the same `ptys.get(id)?.agent` lookup `canClearBox` and `submitSequence` already use.
- `src/composables/useTerminalConnections.ts` — `submitText` (header buttons, the Skill menu's
  `/<slug>`, the worktree commit prompt) and `pasteAndSubmit` (cross-talk), gated by the existing
  `isClaudeTarget`. R1 shows the browser Skill menu has the same dead end on an `esc-cr` host.

Not applied to `insertText` / `pasteText`: those hand the user a draft to review, and their own
Enter is a keystroke they can retry after seeing the menu. Not applied to shell / codex / command
/ dev-terminal sessions at all (S2).

## Deliberately out of scope

`server/session/draft-injection.ts` auto-submits an `initialPrompt` with a **hardcoded `\r`**,
so on an `esc-cr` host that prompt is typed and never submitted regardless of any menu — a
separate gap (#772 covered the browser handler and the phone submit, not this path). A guard
space would not fix it; it needs the configured submit sequence. Reported, not changed here.

## Tests

- `test/common/terminalSubmit.spec.ts` — the helper: appends exactly one space, is idempotent on
  text already ending in whitespace (no double space), leaves a multi-line block ending in `\n`
  alone, adds nothing but that one space. Plus the agent scoping, including a test that it and
  `submitSequenceForAgent` agree on who counts as Claude, so they cannot drift.
- `server/backends/remoteHost/terminalInput.spec.ts` — the `/command` regression end to end: the
  guard is **inside** the paste (a bare space keystroke could be read by an open menu), the paste
  is still opened once and closed once, the submit sequence is unchanged in both modes, the
  Ctrl-C clear still leads the write, and — the trim's own purpose — control-only text still
  throws instead of the guard smuggling it past the emptiness check.
- `test/server/backends/remoteHost/terminalInput.spec.ts` — the sanitizer still trims a trailing
  space (the behaviour the fix routes around rather than removes).
- `test/src/composables/useTerminalConnections.spec.ts` — `submitText` / `pasteAndSubmit` carry
  the guard in both modes; a shell cell's `echo foo\` stays byte-exact; `insertText` / `pasteText`
  do not carry it.
- Mutation-checked: reducing `submittableLine` to the identity function fails 24 tests, so the
  suite pins the behaviour rather than describing it.
