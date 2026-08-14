# feat — name the model on an Antigravity cell's badge

## What it does

An agy cell's header badge said `antigravity`, a constant. It now says the model agy is
running — `Gemini 3.6 Flash` — read from the conversation's own transcript.

## Why the constant was there, and why it goes now

#1466 refused to read the model, and wrote down why: the only mention of one is prose inside
the user turn ("The user changed setting `Model Selection` … to Gemini 3.6 Flash (High)"),
apparently written **only when the setting changed**, so reading it would put a confident,
sometimes-wrong name on the cell.

That reasoning was from the wording, not from the data. Counted across every conversation on
the machine this was written on:

```
transcripts: 50   with a settings block: 50   with more than one block: 0
first-hit line index histogram: {0: 50}
```

agy states the selection at the START of a conversation as a change "from None", whether or not
the user touched the setting. So it is a fact about **this** conversation — which `settings.json`
is not (global, current, and not what an older conversation ran under), and which the cwd's
last conversation is not either (see below).

The bound, stated in the code: the block is read from the **head**, so if agy ever begins writing
a second block mid-conversation, the badge keeps naming the model the conversation STARTED on
until it is next resumed.

## Shape

- `server/agents/antigravity-sessions.ts` — `antigravityModelFromTranscriptHead`, beside the
  title parser that already has to strip the same block. The model name is bounded (48 chars) and
  the sentence terminator is a period **followed by a space or the end of the block**, because
  `Gemini 3.6` contains one too.
- `server/session/agent-badges.ts` — resolves our session id to agy's conversation id through
  `antigravityConversations` (the codex lookup, for the codex reason) and reads 64 KB of the head.
  No tail read: the block is at the front, and a second read that almost never finds anything
  would be paid on every cell.
- `src/components/modelBadge.ts` — drops a trailing bracketed qualifier, so the badge reads
  `Gemini 3.6 Flash` and not `Gemini 3.6 Flash (High)`. The badge is `whitespace-nowrap flex-none`:
  it does not truncate, it pushes the rest of the header's chips out. The full name stays in the tip.

## What #1468 got wrong, kept here as the reason not to redo it

That PR fell back to `cache/last_conversations.json` when the session had no mapping yet. That
file holds only the LAST conversation per cwd and is written at exit (`antigravity-sessions.ts`
says so at the top), so in exactly the case it was reached for — a fresh session — it names a
**previous** conversation. A new cell would show the model of the session before it, and two cells
in one directory would show the same. An unmapped session is answered `null` instead.

## The half that is not parsing: a fresh cell never re-asked

Reported against the first cut: resuming from chat history showed the model, starting a new
terminal did not. Not a parsing bug —

- a **resumed** session records its mapping at spawn, so the cell's seed fetch already reads the
  right transcript;
- a **fresh** one gets its id from a watcher, after agy creates the conversation on the first
  prompt — so the seed fetch legitimately answers "nobody", and **nothing ever asked again**.
  `refreshUsage()` runs on `working -> idle`, and nothing calls `setWorking` for an agy session:
  it has no hooks (claude) and no activity tracker (codex). The badge was frozen at its mount value
  for the life of the session.

Two changes, one on each side:

- `spawn-antigravity.ts` publishes the session row when the capture lands — the one edge where the
  answer changed. `publishActivity` joins `SpawnDeps` next to `publishSessionCreated`.
- `TerminalCell.vue` re-reads its badges on a push **while the model is still unknown**, for a
  non-claude cell. Self-limiting: once a model is known it stops. Claude is excluded because its
  badges come from the summary the route already folds, and this is the busiest route in the app.
  This fixes the same first-turn latency for codex, which mints its rollout id the same way.

Consequence, and it is deliberate: a cell that has not been prompted yet shows **no** model badge
rather than a constant. That is what grok already does before its first turn, and it is what lets
the client tell "unknown" from "known" — which is the whole mechanism above.

## The numbers, from a store with no published format

Follow-up ask: Claude's cell shows `ctx %` and token counts — can agy's? The transcript really has
none (its record types carry `step_index`, `content`, `tool_calls`, `exit_code` and nothing else).
They are in a second store the transcript never mentions:
`~/.gemini/antigravity-cli/conversations/<conversationId>.db`, a SQLite database whose
`gen_metadata` table holds one **protobuf blob per generation**. There is no `.proto` on disk.

The fields were identified by watching them across a real 519-generation conversation:

```
idx=  0  ctx   2,522/256,000  prompt 22,812  out 178  cached       0  thoughts  80
idx=240  ctx 234,987/256,000  prompt  4,901  out 180  cached 227,183  thoughts  94
idx=300  ctx 146,536/256,000  prompt  3,660  out  84  cached 137,957  thoughts  68  <- compacted
```

`1.9.10.1` climbs against `1.9.10.4` = 256,000 and drops on compaction; the per-generation counts
under `1.4` sum to within a few percent of it. That is a context reading and nothing else.

**Everything about the reader is built to answer "nothing" rather than a number it is unsure of**,
because the badge is what a user compacts by:

- `antigravity-proto.ts` walks only the requested path, skipping other fields by length (a 740 KB
  row costs a few dozen byte reads), stops at the first byte it cannot account for rather than
  resynchronising, and never throws;
- `antigravity-usage.ts` gates every reading — a window outside 1 KB–100 M, a `used` above its own
  window, a token count above a billion, a missing leaf — and drops the whole answer rather than
  contributing a zero;
- the two badges are independent, so unreadable accounting still leaves the model named.

If a future agy renumbers these fields, an agy cell shows its model alone. That is the pre-#1465
behaviour, reached quietly.

Two things only the real database revealed, both now pinned by tests:

- **`node:sqlite` throws "column index out of range" on `limit ?`.** A named `$limit` binds.
- **A varint too large to hold must be SKIPPED, not refused.** agy stores an
  `18446744073709551615` sentinel in the very message that holds the context reading. The first
  cut treated "cannot represent" as "cannot continue", stopped there, and reported no context at
  all — with every synthetic fixture passing. Skipping a field never needs its value.

Freshness needed one more piece: with no turn end, the context reading would be frozen at whatever
it was when the cell first asked. An agy cell re-reads its badges once a minute (one indexed
sqlite row plus a 64 KB head read), which is the substitute for the activity tracker it does not
have and should be deleted the day it gets one.

## Verified

- `yarn format` / `yarn lint` (0 errors) / `yarn typecheck` / `yarn test` (8636 passed)
- Against the real stores, not only fixtures — which is where both bugs above came from:

  ```
  a4dbbf1e | Gemini 3.6 Flash (High) | ctx 199141/256000 (78%) | in 4258938 out 266486 cache 75671040
  9ee2d1bb | Gemini 3.6 Flash (High) | ctx 209450/256000 (82%) | in 1789741 out  93143 cache 15236168
  2658608b | Gemini 3.6 Flash (High) | ctx  82657/256000 (32%) | in  195827 out  12216 cache  1706889
  unknown  | null                    | ctx 0/null             | in 0 out 0 cache 0
  ```
- The specs write nothing into `~/.mulmoterminal/` — the spawner spec stubs `remember` and the
  watcher, which the previous spec did not (it left a fake session in the real log).
