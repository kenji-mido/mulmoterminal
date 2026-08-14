# feat: Grok (`grok`) as a fourth first-class agent in the Agent Picker

No tracking issue yet. Written 2026-08-04 against `grok 0.2.118 [stable]` as installed on this
machine — every CLI fact below was read from `grok --help` / `grok mcp add --help` /
`grok inspect` / `~/.grok`, not from documentation.

## Goal

Pick **Grok** in the Agent Picker beside Claude / Codex / Antigravity / Shell and get a real agent
session: it survives a reload and a server restart (resume), it carries the GUI MCP tools its
directory registered, it wears a badge in the sidebar and the tab bar, and the phone can ask the
grid to start one.

Explicitly NOT in scope, and each for a stated reason further down: rate-limit gauges, draft
injection, cost/context reporting, `customAgents` support (`CUSTOM_AGENT_KINDS` stays
`["claude"]`), and launcher-chip changes of any kind — a chip that says `grok` keeps running the
user's command line verbatim (CLAUDE.md).

## What grok's CLI actually gives us

Measured, because the shape of the integration follows entirely from these four facts:

1. **We can mint the session id.** `grok --session-id <UUID>` starts a NEW conversation under an id
   we choose ("must be a valid UUID and must not already exist"), and `grok --resume <id>` /
   `-r <id>` replays it. That is **claude's shape, not codex's** — no rollout watcher, no
   `claimed…` set, no `remember…Conversation` map, no `pickFresh…` ambiguity window. This is the
   single biggest simplification versus the last two agents added, and the plan below is much
   smaller because of it.
2. **Sessions live at `~/.grok/sessions/<percent-encoded cwd>/<uuid>/`.** Partitioned by working
   directory (`%2FUsers%2Fsatoshi%2Fmulmoclaude`), one directory per conversation holding
   `chat_history.jsonl`, `events.jsonl`, `updates.jsonl`, `summary.json`. So the cold-resume probe
   ("does a conversation by this id exist?") is a directory test, like antigravity's — but it needs
   the **cwd** as well as the id, which antigravity's does not.
3. **MCP is a config FILE, not a flag.** There is no `--mcp-config` and no `-c key=value`. Servers
   are registered with `grok mcp add <name> <command-or-url> -t stdio|http|sse -s user|project
   -e KEY=value`, writing `~/.grok/config.toml` or **`./.grok/config.toml`**. So grok is
   **antigravity-shaped** on this axis: per-directory registration, no per-spawn URL, and therefore
   it stays OUT of `FULL_GUI_MCP_AGENTS` (`common/guiMcpAgents.ts`) — it has nowhere to receive a
   session-scoped URL, which is exactly the reason `agy` is out.
4. **Grok already loads `~/.claude/skills`.** `grok inspect` lists all nine `mulmoterminal-*`
   skills as `user [claude]`. The bundled-skill mirror needs NOTHING — no `grok-skills.ts`
   counterpart to `codex-skills.ts`. Verify this once on a clean machine before relying on it.

Other flags worth having read: `-m/--model`, `--permission-mode default|acceptEdits|auto|dontAsk|
bypassPermissions|plan`, `--always-approve`, `--cwd`, `--no-alt-screen`, `--rules`,
`--system-prompt-override`, and a positional `[PROMPT]` for an interactive first turn.

## Design: grok is claude-shaped on resume and antigravity-shaped on MCP

That mixture is the whole design, and it is why grok is not a copy of either file.

| axis | claude | codex | antigravity | **grok** |
| --- | --- | --- | --- | --- |
| session id | we mint (`--session-id`) | it mints, we watch | it mints, we watch | **we mint** |
| resume | `--resume <id>` | `resume <id>` | `--conversation <id>` | **`--resume <id>`** |
| GUI MCP | `--mcp-config` per spawn | `-c mcp_servers.…` per spawn | `.agents/mcp_config.json` file | **`.grok/config.toml` file** |
| full GUI MCP in workspace | yes | yes | no | **no** |

Because we mint the id, `agentResumeId` (`server/agents/agent-resume.ts`) and the
`claimed…`/`remember…` registry machinery are **not needed**. The cold-resume path is claude's:
the browser hands back the id it was given, and the only question is whether a conversation by
that id exists on disk before we pass `--resume`.

## PR stack

Four PRs, each shippable and green on its own. PR#1 alone is a usable Grok cell without GUI tools.

### PR#1 — a Grok cell that runs and resumes

**common/**
- `common/sessionAgent.ts`: add `"grok"` to `SESSION_AGENTS` and `TERMINAL_AGENTS`, plus an
  `AGENT_BADGES` entry (`{ full: "grok", short: "gk" }` — pick the short form deliberately, it is
  what the tab bar shows).
- `common/launchAgent.ts`: add `"grok"` to `LAUNCH_AGENTS`, so the phone may ask for one (#831).
- `common/guiMcpAgents.ts`: `FULL_GUI_MCP_AGENTS` is **unchanged** — add a paragraph to the file's
  header comment saying grok is out for the same structural reason agy is (config file, no
  per-spawn URL). That comment is the file's whole point; a third member of "out" that is not
  explained is what #1423 was.

The Agent Picker (`src/components/agentPicker.ts`) derives its built-ins from `TERMINAL_AGENTS`,
so it needs only the `OPTIONS` label row — no new list.

**server/agents/**
- `grok.ts` — the adapter: `bin: () => process.env.GROK_BIN || "grok"`, `binEnvVar: "GROK_BIN"`,
  no `draftReadyMarker` (see PR#4).
- `types.ts` — `AgentKind` gains `"grok"`; `registry.ts` gains the entry. `AgentKind` is a
  `Record`, so both fail to compile until done, which is the intent.
- `grok-args.ts` — `buildGrokArgs({ sessionId, resume, model, skipPermissions, initialPrompt })`.
  Order matters and is testable: `--session-id <uuid>` XOR `--resume <id>` (never both — with
  `--resume` a `--session-id` is only legal alongside `--fork-session`, and forking is not what a
  reconnect wants), then `--model`, then `--permission-mode auto`, and the positional prompt LAST.
- `grok-session.ts` — `grokSessionsRoot()` (`GROK_HOME` override → `~/.grok/sessions`),
  `grokSessionDir(root, cwd, id)` and `grokConversationExists(root, cwd, id)`. **The cwd encoding
  is the risky part**: `%2F` for `/` says `encodeURIComponent`, but confirm against a session
  created in a directory with a space, a `-`, and a non-ASCII character before writing the spec —
  guessing here fails silently as "resume declined", the worst failure mode this integration has.

**server/session/spawn-grok.ts** — modelled on `spawn-antigravity.ts` minus the watcher:
sync the MCP config (PR#2; a no-op stub here), build argv, `ptySpawn` with
`env: guiMcpEnv(sessionId, PORT)` and `binEnvVar`, `ptyStartLine`, set `agent: "grok"` on the
`PtyEntry`, `wireAgentPtyRelay`. No `captureGrokConversation`, no registry map.

**server/** wiring, all mechanical and all compiler-guided:
- `spawn-deps.ts` — `grokBin`, `grokModel`; `index.ts` — `GROK_BIN`, `GROK_MODEL` (`process.env.GROK_MODEL || null`), pass both.
- `spawners.ts` — `SpawnGrokPty`.
- `routes/terminal-ws-path.ts` — `"grok"` kind + `/ws/grok`; `routes/ws-routes.ts` —
  `handleGrokConnection` + `runGrokWss` + the `serverFor` row. The handler is **shorter than
  antigravity's**: no `…Hydrated` await, and `resolveGrokSession` asks only
  `hasLivePty || tmuxAlive ? no resume : grokConversationExists(root, cwd, requested)`.
- `routes/routeParams.ts` — `normalizeAgent` returns `"grok"` for an exact `"grok"`.

**src/** — `wsUrl.ts` (`grok: "ws/grok"`), `gridTabs.ts` (the `agent?:` union),
`useTerminalConnections.ts`, `GridView.vue`'s launch map, `modelBadge.ts` `AGENT_NAME`,
`AgentMark.vue` (an inline SVG mark — **no emoji**, per CLAUDE.md).

**Tests**: `test/server/agents/grok-args.spec.ts` (the XOR above, flag order, prompt last),
`grok-session.spec.ts` (the cwd encoding, against fixture directories), and the
`registry.spec.ts` rows.

**Acceptance**: pick Grok in an empty cell → it runs; reload the page → same conversation;
restart the server → same conversation; the sidebar and tab bar show the badge.

### PR#2 — GUI MCP through `.grok/config.toml`

`server/agents/grok-mcp.ts`, the counterpart of `antigravity-mcp.ts`, with the same two rules that
file's header states and the same reason for each: the **tool group** is a property of the
directory and goes in the entry's `env`; the **session id** is not and must NEVER be written to the
file — it reaches the bridge through `guiMcpEnv` on the process, because one frozen id in a shared
file sends every later session's tool results to a dead channel.

Reuse `server/mcp/bridge.mjs` unchanged (stdio, `MULMOTERMINAL_TOOL_GROUP` in `env`). The stdio
bridge is what lets us skip the open question of whether grok expands `${VAR}` in a config value —
it inherits grok's environment, so the session id arrives without any expansion at all.

**The one genuinely new problem: the file is TOML, and it is the user's.** `.agents/mcp_config.json`
could be parsed, merged and re-serialised losslessly; a TOML file cannot be round-tripped without a
TOML library, and rewriting one would drop the user's comments and formatting. Two options, and
this needs a decision before coding:

- **(a) Shell out to `grok mcp add -s project -t stdio -e MULMOTERMINAL_TOOL_GROUP=<group> …` and
  `grok mcp remove`** for each group. Grok owns its own file; nothing here parses TOML. Costs a
  subprocess per group per spawn (four at worst) and depends on the CLI's exit codes.
- **(b) Add a TOML dependency** and do the JSON path's merge-and-rewrite, keeping only
  `OUR_SERVER_IDS` under our control.

Recommendation: **(a)**. It is slower and less pretty, and it is the only one of the two that
cannot corrupt a file the user wrote. Measure the four-subprocess cost on a spawn before
committing to it; if it is visible, cache on the group set, since a re-sync is a no-op when
nothing changed.

Also: `excludeFromGit` applies here too — `.grok/config.toml` is a local switch and must not turn
up in the user's `git status`. Note the asymmetry with agy's `.agents/mcp_config.json`: grok's
project config is a file a team might legitimately want to commit, so exclude only the case where
we created it.

Register the same per-group ids (`toolGroupServerId`) — **do not invent a grok-specific id**, and
do not shorten one (CLAUDE.md: those are keys in files users wrote).

**Acceptance**: flip a Canvas switch for a directory, start a Grok cell there, ask it to draw a
chart → it renders in the Canvas pane. Flip the switch off → the entry is gone from
`.grok/config.toml` and the user's own servers in that file are untouched.

### PR#3 — the launcher form and the sessions list

- `CellLaunchForm.vue` already asks `pickCarriesFullGuiMcp`, so a Grok pick shows the four
  per-group toggles rather than "All of them, automatically". Verify this rather than assume it —
  that is precisely the promise #1423 broke.
- A `/api/grok/sessions` route mirroring `/api/codex/sessions`, listing conversations for a cwd out
  of `~/.grok/sessions/<encoded cwd>/`, with `summary.json` as the title source. Check first
  whether `grok sessions list` is cheaper and more stable than reading the directory ourselves; a
  JSON output mode would decide it.
- `session-routes.ts` has a guard about adopting a session on the wrong endpoint — it needs the
  grok case, or a Grok conversation restored from the sidebar reconnects as claude.

### PR#4 — activity, and what is deliberately left out

Grok writes `events.jsonl` and `updates.jsonl` per conversation, so working/waiting could be
tracked the way `codex-activity-watch.ts` tracks a rollout. **Do this only if the PTY screen scan
proves insufficient** — measure first. The codex watcher exists because codex's screen was not
readable enough, not because a watcher is the standard.

Left out on purpose, each with the reason:
- **Rate limits** — the gauge is fed by claude's `statusLine` and codex's rollout. Grok exposes
  neither; `rateLimitGauge.ts`'s `"claude" | "codex"` union stays as it is.
- **Draft injection** — needs a measured `draftReadyMarker` from grok's real TUI. Until someone
  reads one off a live session, the adapter omits it, exactly as codex's does.
- **`customAgents`** — `CUSTOM_AGENT_KINDS` stays `["claude"]`. Adding `"grok"` means teaching the
  spawn to append GROK's argv to a user's wrapper command, which is a separate feature.
- **Launcher chips** — nothing. A chip whose command is `grok` runs verbatim, records
  `agent: "shell"`, and gets no MCP. Re-adding a recogniser is the thing CLAUDE.md forbids.

## Status: PR#1 and PR#2 are implemented (2026-08-04)

Shipped in this branch, green on `yarn format` / `lint` / `typecheck` / `test` (8340 passing):
the adapter, argv, session probe, spawner, `/ws/grok`, the MCP sync, and every UI site the closed
unions forced. Verified against a real `grok 0.2.118` rather than only in tests — see below.

**PR#3 is partly done**: the launcher form was verified (and pinned by a spec) to offer grok the
per-group toggles rather than the "All of them, automatically" claim. `/api/grok/sessions` and the
sidebar's restore path are NOT done. **PR#4 is not started**, as planned.

### What the live check showed

- A grok cell runs: `grok --session-id <minted uuid> --permission-mode auto`, TUI up, status line
  `Grok 4.5 (high) · auto`.
- grok persisted that conversation at
  `~/.grok/sessions/%2FUsers%2Fsatoshi%2Fgit%2Fai%2Fmag2/<the id we minted>/` — so the id we chose
  IS grok's id, and `grokConversationExists` answers true for it, false for the same id under
  another cwd, and false for an id grok never minted.
- The MCP sync registers the bridge in the project's `.grok/config.toml`, removes an entry when its
  group is switched off, removes all of them when none is on, and leaves a user's own `playwright`
  server untouched throughout. A directory already in the desired state runs no subprocess.

### The bug the live check caught, which every green signal had missed

`grok mcp add` ends in `<command> -- <args…>`, and everything after the `--` belongs to the server
being registered. The first implementation appended `-s project` at the END, so the flag was handed
to the BRIDGE, grok never saw it, and the add silently fell back to **user scope** — writing four
entries into `~/.grok/config.toml`, where every directory on the machine would have picked them up.
It exited 0 and left the project file untouched. Typecheck, lint and 8337 tests all passed.

Only running it against a real directory and then LOOKING AT THE FILE found it. The leaked entries
were removed with `grok mcp remove -s user`; the argv is now built by `grokMcpAddArgs` /
`grokMcpRemoveArgs` with a spec asserting the scope flag precedes the `--`.

The lesson generalises to the next agent: for a CLI whose config we drive through its own
subprocess, exit code 0 is not evidence, and neither is a passing suite. Read the file back.

## Open questions — resolved

1. **The cwd encoding** — `encodeURIComponent`, exactly. Measured against a directory containing a
   space, a hyphen and non-ASCII: `/tmp/grok enc-test/日本語-dir` →
   `%2Ftmp%2Fgrok%20enc-test%2F%E6%97%A5%E6%9C%AC%E8%AA%9E-dir`. Pinned by a spec.
2. **`--session-id` on a live id** — fails LOUDLY (`Session ID … is already in use`), which is why
   the resume decision resumes whenever the conversation exists on disk rather than gating on
   `!tmuxAlive`: if tmux dies between the check and the spawn, `--resume` reattaches where
   `--session-id` would abort. Same rule `resolveSession` already applies for claude.
3. **`--no-alt-screen` / `--fullscreen`** — neither is needed. The default TUI renders and replays
   correctly through the tmux-backed PTY as it stands.
4. **TOML option (a) vs (b)** — (a), grok's own CLI. Cost measured at ~0.16s per changed group, and
   the diff means an unchanged directory pays nothing.
5. **The badge short form** — `gk`.

## Open questions that were never settled (still open)

None blocking. The remaining work is PR#3's session list and PR#4's activity tracking, both of
which the plan already scopes.

## The original open questions, as written before any of this

## Open questions to settle before PR#1

1. **The cwd encoding in `~/.grok/sessions/`.** Confirm against directories containing a space, a
   `-`, and a non-ASCII character. Everything about resume rests on it.
2. **`--session-id` under tmux reattach.** Confirm that a second `grok --session-id <uuid>` for an
   id that already exists fails loudly rather than silently starting fresh — `ptyWouldReattach`
   should mean we never do it, but the failure mode decides how defensive the guard must be.
3. **`--no-alt-screen` / `--fullscreen`.** Which one gives the same terminal-replay behaviour the
   other agents have in a tmux-backed PTY? A wrong choice here shows up as a cell that replays
   blank after a reload.
4. **PR#2 option (a) vs (b)** — the owner's call.
5. **The badge short form** — `gk`? `gr`? It is two characters in the tab bar and is user-visible.

## Docs, at the end and not skipped

`README.md`, `docs/guide/{en,ja}/basics.md` + `config.md` + `glossary.md` (both languages, kept in
sync), and `server/skills/mulmoterminal-model/SKILL.md` — which is the skill that owns "which agent
and which model", and is exactly the kind of single owner #1097 warns about missing. Plus a
`docs/ChangeLog.md` entry and a dated setup guide page when this ships in a release.
