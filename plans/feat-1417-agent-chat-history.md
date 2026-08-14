# feat: "or resume here" shows the PICKED agent's own chat history (codex / agy / grok), not Claude's

Tracking issue: **#1417** (refs #1096, #1218). Written 2026-08-04. Every on-disk fact below was
read from this machine's `~/.codex`, `~/.gemini/antigravity-cli/brain`, `~/.grok` and from the
routes already in this repo — not from documentation.

## The bug, stated precisely

`CellLaunchForm.vue`'s **"or resume here"** list is fed by `useResumableSessions()` →
`GET /api/sessions?cwd=`, and that route reads **`~/.claude/projects/<encoded cwd>/*.jsonl`**
(`server/routes/session-routes.ts:190`, `projectSessionsDir`). It is Claude's transcript directory
and nothing else.

So the rows shown are Claude conversations **whatever the Agent Picker has selected**. Pick Codex
and the list still offers Claude sessions; click one and the cell connects the codex endpoint to a
key that only ever named a Claude transcript. Meanwhile a real past codex / agy / grok conversation
in that directory is **unreachable from any UI** — the issue's own table says so.

## Answer: yes, all four are listable and resumable. The plumbing is mostly already here

| | list rows from | resume flag | already in repo |
|---|---|---|---|
| claude | `~/.claude/projects/<enc cwd>/*.jsonl` | `--resume <id>` | `GET /api/sessions?cwd=` — **wired** |
| codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, `session_meta.cwd` filters | `codex resume <id>` | `listCodexSessions()` + `GET /api/codex/sessions` — **built, zero callers** |
| antigravity | our `antigravity-conversations.jsonl` for the cwd × agy's `brain/<id>/…/transcript.jsonl` for the title | `--conversation <id>` | `listAntigravitySessions()` + `GET /api/antigravity/sessions` — **built, zero callers** |
| grok | `~/.grok/sessions/<encodeURIComponent(cwd)>/<uuid>/` | `--resume <id>` | **nothing — this plan writes it** |

Both existing routes carry the comment "NOTHING IN THIS REPO CALLS THIS … kept deliberately as the
base for that list (#1417)". This plan is that call site.

The **resume side already works for all four**: `ws-routes.ts` asks `agentResumeId()` with a
`conversationExists()` probe per agent — `codexRolloutExists` (:387), `antigravityConversationExists`
(:645), `grokConversationExists` (:725) — precisely so that "the sidebar hands these over": a
browser-supplied key that is itself one of the agent's conversation ids resumes that conversation.
Nothing in the spawn path needs changing.

### Grok is the only new listing, and it is the easiest of the four

`~/.grok/sessions/` is partitioned **by working directory**, percent-encoded with
`encodeURIComponent` (already measured and pinned by `encodeGrokCwd()` in `grok-session.ts`), so a
per-cwd listing is one `readdir` — no date-tree scan, no cwd filter, no cross-referencing our own
log. Per conversation directory:

- `summary.json` — `{ info: { id, cwd }, session_summary, generated_title, created_at, updated_at,
  last_active_at, num_messages, head_branch, … }`. Title and mtime in one small file.
- `prompt_history.jsonl` sits **beside** the uuid dirs, one per cwd, each line
  `{ timestamp, session_id, prompt, is_bash }` — the fallback title source.

Measured on 7 real conversations: 7/7 have `summary.json`; **1/7 had an empty `session_summary`
and no `generated_title`** (a session that ended before grok generated one). So the fallback is
required, not theoretical: read the cwd's `prompt_history.jsonl` once, take the first prompt per
`session_id`, and fall back again to a `"Grok session"` default plus the directory's stat mtime.

## Design decision: FILTER by the Agent Picker — do not merge into one mixed list

#1417 assumed the three lists get merged and left four open questions about the mixed list (badges,
"always idle" codex/agy rows sitting next to live Claude rows, limits and ordering). **Filter
instead**, which is what the user asked for and what removes all four questions:

- The launcher already owns an agent choice — the Agent Picker sits directly above this list. One
  agent selected → one agent's history. No `agentBadge()` on the rows (every row is the picked
  agent; a badge on all of them means nothing), no mixed idle/live confusion.
- **The list reloads when the picker changes**, exactly as it already reloads when the directory
  changes. `forgetForDir()` must run on that change too: a codex row left standing under "Claude"
  for the length of a fetch is the #1372 mistake in a second dimension.
- **Shell shows no list at all** (a shell resumes nothing), and neither does a **custom agent** —
  it runs Claude Code, so it takes the *claude* list (`launchesClaude` in `CellLaunchForm.vue:94`
  is the predicate that already knows this; the same one gates the model picker).
- The heading gains the agent's name — "or resume a codex conversation here" — so the section
  cannot be misread as the general one.

The user's fallback ("if it can't be done, hide the list for that agent") stays as the **empty
state**, not as the outcome: all four can be listed, but a directory with no conversations for the
picked agent renders nothing, as today.

## Work, in landable pieces

### PR 1 — grok listing (server only)

- `server/agents/grok-sessions.ts`, modelled on `codex-sessions.ts`:
  `listGrokSessions(root, cwd, limit): Promise<GrokSessionSummary[]>` — `readdir` the cwd's
  directory, keep UUID entries (reuse the `UUID_RE`/`grokSessionDir` already in
  `grok-session.ts`), read `summary.json` for each (cap the scan at `SCAN_LIMIT = 200`, matching
  the other two), title = `generated_title || session_summary || first prompt from
  prompt_history.jsonl || "Grok session"`, mtime = `last_active_at ?? updated_at ?? stat.mtimeMs`,
  sort desc, slice.
- `GET /api/grok/sessions?cwd=` in `session-routes.ts` beside the other two, same
  `workspaceForRoute` + `SESSION_LIST_LIMIT` shape. Document it in README's HTTP API table with
  the others.
- Spec: `test/server/agents/grok-sessions.spec.ts` over a temp root — the empty-title fallback
  chain and the percent-encoded/non-ASCII cwd (the silent failure mode `encodeGrokCwd`'s spec
  already warns about).

### PR 2 — `attached` on the three foreign lists

Claude rows carry `attached`, computed once per request from `tmuxAttachedCounts()` +
`sessionAttached()` (`session-routes.ts:243`), and `CellLaunchForm.sessionBusy()` refuses a row
that has it. Without the same field a codex row offers to resume a conversation that is **live in
another cell**, which starts a second codex on it.

Two cases, and the second is the one that bites:

1. Resumed *from this list*, the session key **is** the conversation id — `sessionAttached(id, …)`
   answers directly. Free.
2. Started *from a cell*, the key is one MulmoTerminal minted and the conversation id is only
   reachable through our own log: `codexRollouts` and `antigravityConversations`
   (`registry.ts:569,577`), both `ReadonlyMap<sessionKey, AgentConversation>`. So the route must
   invert that map (conversationId → sessionKey) and ask `sessionAttached()` about the **key**.
   Grok needs no inversion — we mint its id, so key === conversation id.

Add `attached` to all three routes this way. `hidden` / `failed` are Claude-only concepts (hidden
workers and background chats are Claude sessions) and stay absent — `PartialWorkerStatus` already
makes them optional.

### PR 3 — the UI (the actual fix)

- `useDirLists.ts`: one composable per source is unnecessary — `useDirList` only takes a URL, so
  make the resumable one take the agent:
  `useResumableSessions()` builds its URL from a reactive agent (`claude` → `/api/sessions`,
  `codex` → `/api/codex/sessions`, `antigravity` → `/api/antigravity/sessions`, `grok` →
  `/api/grok/sessions`). Keep the URL map in **`common/`** if the server ever needs to agree with
  it; a `Record<TerminalAgent, string>` derived from `TERMINAL_AGENTS` so a fifth agent is a type
  error rather than a silently Claude-listed one.
- `CellLaunchForm.vue`: `loadForDir` passes the resolved agent; the existing `watch` on
  `[() => props.dir, () => props.defaultCwd]` gains `() => props.agent` (with the same
  `forgetForDir()` + debounce path — a picker click is not typing, so it can skip the debounce the
  way `fillDir` does).
- `resume()` emits the picked agent alongside the id: `emit("resume", { id, cwd, agent })`.
  `TerminalCell.resumeSession()` (line 463) already accepts and applies `agent` — today only the
  worktree row sends it, and its comment says the list "all Claude" is why. That comment becomes
  wrong with this change and must be updated in the same PR.
- Empty/absent: shell → section hidden; custom agent → claude's list.
- Specs in `test/` for `CellLaunchForm`: switching the picker refetches and clears first; a codex
  row's click emits `agent: "codex"`; shell renders no section.

### PR 4 — docs

- `docs/ChangeLog.md` entry, and the dated setup guide page in both languages if this lands in a
  release (CLAUDE.md's publishing rules). This is a *visible* change — the guide page wants a
  screenshot of the list under a non-Claude agent, captured under a scratch `HOME` per the
  screenshot traps in CLAUDE.md.
- README HTTP API table: the new grok route, and drop the "no in-repo caller" framing from the
  codex / agy rows once PR 3 lands. The same sentence in `session-routes.ts` above
  `codexSessionList` must go with it — it is the load-bearing explanation for why those routes
  exist, and leaving it is worse than never having written it.

## Traps, each already paid for once by somebody

- **Do not add these lists to `useSessions()`.** #1417's own hand-off explains it: `useFaviconState`
  reconciles the authoritative list over the live pub-sub stream, codex/agy rows have no activity
  tracking (`working: false` fixed), and after a resume the session key equals the row id — so a
  running session's favicon flips back to idle on every refetch. The launcher's own
  `useResumableSessions()` never reaches the favicon, which is why this plan puts it there.
- **The rows are dropped on a dir change AND on an agent change** (#1372). An offer that outlives
  the state it was fetched under is an offer to open something other than what it says.
- **codex / agy / grok rows have no activity, ever.** With the filtered design nobody compares them
  to a live Claude row, but do not "fix" it by inventing a status field the server cannot answer.
- **Grok's cwd encoding is the silent failure.** A mismatch finds no directory, the list is empty,
  and nothing errors — the same failure `encodeGrokCwd`'s header warns about for resume. Its spec
  is the guard; extend it, don't re-derive the encoding.
- **Antigravity's list can only ever show conversations MulmoTerminal started.** The cwd comes from
  our log because agy records it nowhere queryable (`antigravity-sessions.ts` header). A
  conversation started in the Antigravity IDE will not appear, and that is correct rather than a
  gap to close — say so in the guide instead of leaving the user to wonder.
- **Worktree rows are unaffected.** They already carry `agent` and resume by whatever the session
  is; nothing in this plan touches `worktreeAction()`.

## Not in scope

Cockpit roster and favicon coverage for non-Claude sessions (#1419's territory), any change to
launcher chips (CLAUDE.md: a chip runs the user's command verbatim), and per-agent activity
tracking.
