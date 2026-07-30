# What the phone can ask this host (developer reference)

The companion phone client is a **separate app in a separate repo** —
[receptron/mulmoserver](https://github.com/receptron/mulmoserver), deployed at
<https://mulmoserver.web.app>. It talks to MulmoTerminal over Firestore command docs, not HTTP,
so nothing in `README.md`'s `/api/*` table describes it.

This page is the contract between the two: **every command the host answers, the shapes it
answers with, and the rules that decide what belongs on which side.** Written because three
features in a row (#830, #831, #832) each had to re-derive them by reading the handlers.

> Adding or changing a command? Update this page in the same commit, and file the matching
> issue on `receptron/mulmoserver` — the phone ignores a field it was never taught about, so a
> host-only change ships as silence rather than as a feature.

## Transport

`@mulmoclaude/core/remote-host/server` owns it. The host signs in with the user's Firebase
account, subscribes to a per-user command channel, and answers each doc it sees.

- `HOST_ID = "mulmoterminal"` (`server/backends/remoteHost/index.ts`) — distinct from
  MulmoClaude's, so both can be registered to one account.
- The subscription is wrapped in **`resilientRunner`** (#823): core gives up on its listener
  permanently, so the wrapper re-subscribes and gives up on TIME rather than a retry count.
  `GET /api/remote-host/status` reports `health` (`online` / `reconnecting` / `offline`).
- A handler that **throws** turns into the phone's error message. That is the intended way to
  refuse — the phone shows the sentence, so write it for a person.

## Commands

Handlers live in `server/backends/remoteHost/handlers/`, one file per command (the same layout
MulmoClaude uses); `handlers/index.ts` is the table that names them all, and the terminal ones are
grouped in `handlers/terminalSession.ts`.

| Command | Params | Answers |
|---|---|---|
| `listTerminalSessions` | — | `{ sessions: TerminalSessionSummary[] }` |
| `getTerminalScreen` | `sessionId` | `SessionScreen` |
| `sendTerminalInput` | `sessionId`, `text` | `{ sent: true }` |
| `launchTerminal` | `agent`, `sessionId` | `{ ok: true }` |
| `startChat` | `message`, `attachments?` | `{ started: true, chatId }` |
| `listFeeds` | — | `{ feeds }` |
| `getFeed` | `slug`, `offset?`, `limit?` | the feed page |
| `listCollections` | — | `{ collections }` (feed-backed ones excluded) |
| `getCollection` | `slug`, `offset?`, `limit?` | one page of the collection's items |
| `listShortcuts` | — | `{ shortcuts }` |
| `listSkills` | — | `{ skills }` (collection slugs excluded) |
| `listAccountingBooks` | — | `{ books: { id, name }[] }` |
| `getRemoteView` | `slug`, `viewId`, `locale?` | `{ view, srcdoc, bytes }` |
| `getRemoteViewItems` | `slug`, `viewId`, `offset?`, `limit?`, `fields?` | `{ page, inlined, omitted }` |
| `mutateRemoteViewItem` | `slug`, `viewId`, `op`, `id`, `patch?` | `{ op, item }` / `{ op, id }` |

The three `*RemoteView*` commands serve a collection's **mobile custom views**. The host wraps
each view into its sandboxed `srcdoc` (CSP + postMessage bootstrap) and the phone renders that
verbatim, so the view's own code never runs with the phone's privileges. A write is authorized
**host-side** against the view's declared surface (`editableFields` / `allowDelete`) — the
sandboxed view is not trusted to police itself. `mutateRemoteViewItem` answers
`{ applied: true, warning }` rather than throwing when the write landed but its response blew
the byte budget, so a successful edit is never shown as a failure (#747).

Image fields are **not** inlined by this host (there is no thumbnail store yet): they come back
as workspace paths, unrenderable on the phone, and count toward `omitted`.

### `TerminalSessionSummary`

```ts
{ id: string; title: string; cwd: string; live: boolean; agent: "claude" | "codex" | "shell" | null }
```

`live: false` means the session exists only in tmux — it outlived a restart. Still viewable
(`capture-pane` doesn't need our process) but **not writable**, and `agent` is then `null`
because the process that knew what it was launched with is gone.

The list is filtered to **grid cells**: the single-view chat session and any tmux shell that
was never a cell are excluded, even while live.

### `SessionScreen`

```ts
{
  screen: string;            // the rendered terminal, trailing blank lines trimmed
  suggestion: string;        // the agent's dim ghost text, "" when none (#563)
  quickCommands: { label, text }[];   // the user's saved phrases for THIS session (#830)
  cwd?: string;              // ─┐
  branch?: string;           //  │ absent when the host cannot answer —
  memo?: string;             //  │ see "absent vs empty" below (#786)
  summary?: string;          //  │
  prompt?: string;           //  │
  githubUrl?: string;        // ─┘ the repository ROOT, never /tree/<branch> (#832)
}
```

**`memo` and `summary` are two different sentences, not two spellings of one** (#1110). `memo` is
the one line the user typed about the session (#1084); `summary` is what the AI called it. The
picker's `title` carries the memo *instead of* the AI title because a row there is a single line
and the user's words win — but a header has room for both, so here they arrive as their own fields
and the memo is drawn above. Putting a handwritten note into a row labelled as the AI's summary
would mislabel it.

## The rules that keep coming up

**`SessionScreen` is the wire shape.** A field added to it reaches the phone without touching
the handler — that is stated in the handler's own comment and is the intended extension
point. Adding a command is the exception, not the rule.

**The host decides; the phone renders.** `quickCommands` is filtered to the session's kind
host-side and the `agents` scope is stripped, so the phone needs no notion of session kinds.
Same shape as `githubUrl`: the phone's whole rule is "render it if it's there."

**Absent vs empty is load-bearing.** `definedScreenMeta` drops a meta field the host can't
answer, key and all: a Firestore command doc rejects `undefined`, and the phone renders each
field it receives as its own labelled row, so `""` would read as "this session has no branch"
rather than "not known". **It calls `.trim()` on every value, so only strings may live in
`SessionScreenMeta`** — `quickCommands` is an array and sits on `SessionScreen` directly,
always present, `[]` when nothing applies.

**The phone never sends a path.** `launchTerminal` takes a session id and the host looks the
directory up (`ptys.get(id)?.cwd`). A path parameter would let a remote client choose where a
process starts. Apply this to anything new that touches the filesystem.

**Authorization is the connected Firebase account, with no per-command gate.**
`sendTerminalInput` already types arbitrary text into a Claude session, which can run anything,
so a command that acts within a session the phone can already drive is not an escalation. A
command that reaches *outside* one would be, and needs its own thinking.

## `launchTerminal` has a prerequisite the others don't

The grid is **browser state**. `markDevTerminalSession()` is reached only from
`server/routes/ws-routes.ts` — "the single choke point for every grid attach" — so the host
cannot open a cell itself. It publishes to the `launch-terminal` pub/sub channel and a
connected browser opens it through the ordinary path.

Consequences the phone has to live with:

- **A MulmoTerminal tab must be open on the desktop.** With none subscribed the host refuses
  with `no MulmoTerminal browser is open — the grid opens the terminal, so a tab must be
  connected`. It does not fail silently.
- Delivery goes to **one** subscriber (`publishToOne`), not the room: a broadcast would open a
  terminal per open tab.
- `agent` is `"shell" | "claude" | "codex"` (`common/launchAgent.ts`) — deliberately not the
  user's configured `launchers`, which are arbitrary commands.

## Where the pieces are

| Concern | File |
|---|---|
| Command handlers | `server/backends/remoteHost/handlers/` (one file per command; `index.ts` is the table) |
| Session list + screen assembly | `server/backends/remoteHost/terminalScreen.ts` |
| Typing into a session (sanitize, bracketed paste, Enter timing) | `server/backends/remoteHost/terminalInput.ts` |
| Quick-command scoping | `server/backends/remoteHost/quickCommands.ts` |
| Launch validation | `server/backends/remoteHost/launchTerminal.ts` |
| Reconnect + health | `server/backends/remoteHost/resilientRunner.ts`, `healthNotice.ts` |
| Wiring (PTY table, pub/sub, config) | `server/index.ts` |
| Shared with the UI | `common/sessionAgent.ts`, `common/quickCommands.ts`, `common/launchAgent.ts` |

## Related

`docs/spawn-architecture.md` (how a session is spawned), `docs/terminal-notes.md` (the terminal
stack). Issues: #435, #445, #563, #572, #781, #786, #823, #830, #831, #832.
