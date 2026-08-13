# The harness's injected prompts reach the header, because the fix landed on one side (#1384)

A cell whose session has a background task shows this on row 1:

```
<task-notification> <task-id>boen82mbm</task-id>
```

and keeps showing it. The task the user actually typed is gone, and the AI title is generated from
the XML.

## The judgment already exists — it is just not on this path

"A harness-injected block is not a typed prompt" was decided in **`e1e19c66`** (2026-07-22):

```
fix: treat <task-notification> as an injected block, not a typed prompt
 server/session/transcript.ts           |  7 +++++--
 test/server/session/transcript.spec.ts | 13 +++++++++++++
```

Two files. The commit fixed the path that **reads a transcript**; the path that **receives the live
hook** was never touched, and nothing pointed from one to the other.

`lastPrompts` — the map row 1 reads — has exactly two writers:

| writer | filtered? |
| --- | --- |
| `hook-routes.ts:103`, seeding from the transcript (`latestUserPrompt` → `collectPrompts` → `userPromptText`) | yes, by `e1e19c66` |
| `hook-routes.ts:106`, the `UserPromptSubmit` hook (`headerHookEffect` → `trackPromptForHeader`) | **no** |

The transcript fallback in `sessionDetailView` is filtered too — `readSessionSummary` →
`createSummaryScan().finish()` → `latestMeaningfulUserPromptFromParsed` → `userPromptText`. So the
live hook is the only way the XML can reach the screen, which is why the symptom needs a *live*
background task to appear.

`headerHookEffect` asks two questions and neither is this one:

```ts
if (event === "UserPromptSubmit") {
  if (typeof body.prompt !== "string" || !body.prompt.trim()) return null;
  return { kind: "prompt", text: body.prompt.trim().slice(0, cap) };
}
```

`preferredHeaderPrompt` does not save it either: its only guard is `isTrivialPrompt`, which drops
short acks like "ok". A 200-character XML block is the opposite of trivial, so it is taken as the
session's most meaningful prompt and stays.

## What actually breaks

`applyHeaderHooks` turns one `kind: "prompt"` into two writes, and `lastPrompts` is read from five
places:

| consumer | what the user sees |
| --- | --- |
| `session-routes.ts:91` → `sessionDetailView` | cell row 1 (the reported symptom) |
| `hook-routes.ts:140` `noteTitleTurn` | the AI title is generated **from the XML** |
| `lifecycle.ts:199` | the session-list payload |
| `task-push.ts:54` → `buildPushDetail` (`reply \|\| lastPrompt \|\| aiTitle`) | a Web Push whose body is the XML, whenever the reply read comes back empty |
| `index.ts:707` `promptOf` → `remoteHost/terminalScreen.ts:240` | the remote host's terminal screen |

`handleActivityHook` is a separate path, so working/waiting is unaffected — correctly: an injected
prompt does start a real turn.

## Ground truth: what the harness actually writes

Scanned every user line of every transcript on this machine — 9,902 files, 26,457 user lines
carrying text — joining content blocks the way `userPromptText` does, and asking whether each marker
leads the text or sits inside it:

| marker | at start | embedded |
| --- | --- | --- |
| `<task-notification` | **3,643** | 591 |
| `<command-` | 669 | 0 |
| `<local-command` | 361 | 0 |
| `<bash-` | 158 | 0 |
| `<system-reminder` | **0** | 9 |

Two things follow.

**The anchor is load-bearing and correct.** 591 lines mention `<task-notification` mid-text — the
`/loop` skill's own documentation, among others. An unanchored match would delete those real
prompts. `^\s*<` keeps them, and `transcript.spec.ts` already pins that.

**`<system-reminder>` has never once led a user line here.** All 9 occurrences are inside skill
bodies. The issue asks for it, and this plan adds it, but as *defence against a shape the harness
does not currently produce* — not as a second cause of the reported bug. It is anchored like the
rest, so the cost is one case: a person whose prompt literally begins with `<system-reminder>` gets
no header update. That trade is already accepted for the four markers above.

## The fix

One predicate, exported, called from both sides — so the next marker cannot be added to one path and
forgotten on the other.

1. `server/session/transcript.ts`: lift the inline regex out of `userPromptText` into an exported
   `isInjectedPrompt(text: string): boolean`, and add `system-reminder` to its marker list.
   `userPromptText` calls it; its behaviour is unchanged for the four existing markers.
2. `server/session/header-hook.ts`: `headerHookEffect` returns `null` for a `UserPromptSubmit`
   whose prompt is injected.

Returning `null` is "this hook changes nothing about the header" — the function's existing meaning,
already used for a blank prompt. It is not "clear it": the real prompt from before the background
task stays on screen, which is the wanted behaviour. Deciding it there covers `trackPromptForHeader`
and `noteTitleTurn` at once, and through them all five consumers above, instead of two `if`s at the
call site.

`header-hook.ts` currently imports nothing at all. `transcript.ts` imports only `isRecord` and
`readString` and touches no filesystem, so the dependency stays pure and the spec keeps running with
no module graph.

## Tests

The failure mode being fixed is *drift between two call sites*, so the tests pin the agreement, not
just each side:

- `test/server/session/injectedPrompts.ts` — one fixture list of injected samples and of prompts
  that merely mention a marker.
- `transcript.spec.ts` and `header-hook.spec.ts` both iterate **that same list**: every injected
  sample is `null` from `userPromptText` and `null` from `headerHookEffect("UserPromptSubmit", …)`;
  every near-miss survives both. Sharing the predicate is what makes the two paths agree; sharing
  the list is what holds each call site to it, so a path that stops consulting the predicate — an
  early return, a re-inlined copy — fails its own spec against shapes the other still refuses.
- A direct `isInjectedPrompt` spec for the boundaries the anchor decides: leading whitespace and
  newlines count as leading, mid-text mentions do not, a bare `<` does not.
- The existing `header-hook.spec` cases stay as they are — a normal prompt, the cap, `/clear`,
  `Stop` — so the new branch is shown not to have moved them.
