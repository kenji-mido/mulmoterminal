# fix #1467 — one predicate was answering three different questions

## The bug behind the bug

`POST /api/tmux/cleanup-orphans` has had no caller since #367, which is what #1467 reports. Wiring
it at boot was measured against this machine and would have reaped **2 of 22** sessions, because the
predicate it consults is wrong for the question it is being asked.

`isResumableTmuxSession` = `live ∨ grid log ∨ claude transcript ∨ codex rollout`. Three callers ask
it three different things:

| caller | what it actually wants to know | today's rule |
|---|---|---|
| the phone's `buildSessionList` | can a user usefully **open** this? | correct |
| `cleanup-orphans` | may we **end** this? | **wrong** |
| the Settings list's `not resumable` column (#1479) | does ending it **lose the conversation**? | **wrong** |

For the second, two of the four limbs are permanent records of "this once existed": a transcript is
never deleted, and `dev-terminal-sessions.json` is append-only (439 entries on this machine). A
transcript on disk means the conversation can be restored **without** the tmux session — an argument
for ending it, not against. So nothing was ever reapable.

For the third, `live ∨ grid` was counted as "restorable", which it is not: on this machine 20 of 22
rows claimed to be restorable while only the 15 with a transcript actually are.

## What ships

**Split the one predicate into the three questions**, in `server/infra/tmux.ts` beside the original:

- `isResumableTmuxSession` — unchanged, still the phone's OFFER rule.
- `isRestorableSession(id, claudeOnDisk, hasCodexRollout)` — **transcript or rollout only**. What
  makes ending a session safe, and what the Settings column now shows.
- `reapableTmuxSession({ attachedCount, liveHere, idleSeconds, idleDays })` — may we end it without
  asking. **Nothing about the past**: not attached (a `null` count is "held", never killed on a
  guess), no pty of ours, and idle for at least the threshold. An unknown age is never reaped.

**The sweep runs once at boot** (#1467's own ask), through the same rule, and says what it did:

```text
[tmux] reaped 3 idle session(s) — nobody attached, untouched for over 7 days
[tmux] kept 18: 6 attached, 12 active within 7 days
```

**`sessionIdleReapDays`** in `~/.mulmoterminal/config.json`, default **7**, `0` disables the sweep
entirely. Also a stepper in Settings → *Sessions that survived a restart*, since that is the list
the number governs.

**Each row of that list says whether it is next** (`ends at next start`), so the automatic behaviour
is visible in the place that shows what it will act on, rather than being a surprise after a restart.

## Files

| file | |
|---|---|
| `common/sessionReap.ts` (new) | the default, the sanitizer, days→seconds |
| `server/infra/tmux.ts` | `isRestorableSession`, `reapableTmuxSession` |
| `server/infra/tmux-routes.ts` | `cleanup-orphans` uses the new rule; `orphanReapable` goes |
| `server/session/surviving-sessions.ts` | `resumable` becomes restorable-only; rows carry `reapable` |
| `server/session/reap-idle-sessions.ts` (new) | the boot sweep and its log lines |
| `server/index.ts` | run it after the persistence line |
| `server/config/*` | the config key |
| `src/composables/sessionReap.ts`, `SurvivingSessionsSection.vue` | the stepper, the row marker |
| `docs/guide/{en,ja}/config.md`, `mulmoterminal-config` skill | the key |

## Tests

- `reapableTmuxSession`: attached / attachment unknown / live here / idle unknown / under the
  threshold — each refused, and the one case that is reaped.
- `isRestorableSession`: a grid-logged shell is NOT restorable (the #1479 column's bug).
- the sweep: reaps only what the rule allows, counts what it kept and why, and does nothing at all
  when the threshold is 0.
- the config key: clamped, `0` kept, junk falls back to 7.
- the section: the row marker, and the stepper posting the right field.

## Not in this change

- Pruning `dev-terminal-sessions.json`. It is append-only and grows forever, but nothing decides a
  KILL from it any more — it is now only the chat sidebar's exclusion list, where its permanence is
  what makes it correct. Left as a note on #1467's thread.
- Identifying an agy / grok survivor (see #1479).
