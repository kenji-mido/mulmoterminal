# Two flags, one gesture: `--strict-mcp-config` rides along with the GUI MCP (#1338, #1385)

Two issues, filed separately and triaged as unrelated — one a regression, one "by design" — are the
same line of code.

`server/agents/claude-args.ts:52`

```ts
guiArgs.push("--mcp-config", input.mcpConfig, "--strict-mcp-config");
```

These answer different questions:

| flag | meaning | who needs it |
| --- | --- | --- |
| `--mcp-config` | **also** load our broker (additive) | every GUI session |
| `--strict-mcp-config` | load **only** this (subtractive) | nothing, except the rate-limit probe |

Because they are pushed together, "give this session the GUI panel" silently also means "cut it off
from the user's own MCP" — the claude.ai connectors, `~/.claude.json`, plugin servers, and the
directory's own `.mcp.json`.

`carriesFullGuiMcp(attachGuiMcp, cwd) = attachGuiMcp || isWorkspaceCwd(cwd)` routes both reporters
into that line:

- **#1385** — single view: `attachGuiMcp = true`.
- **#1338** — grid cell in the workspace: `isWorkspaceCwd(cwd) = true` (added by #1187).
- a project-directory cell: neither, so no flags — which is exactly why connectors work there and
  nowhere else.

## The reason the flag was there is gone

Measured on **CLI 2.1.221** in `~/mulmoclaude`, reading `mcp_servers` off the `system`/`init` event:

| spawn | `init.mcp_servers` |
| --- | --- |
| `--mcp-config` alone | **3** — our broker + `claude.ai Superhuman Docs` + `claude.ai Gmail` |
| `--mcp-config --strict-mcp-config` | **1** — our broker alone |

Dropping strict keeps the broker **and** restores the connectors. The #1043 concern that a merge
silently drops our broker does not reproduce. MulmoClaude reached the same conclusion at CLI 2.1.163
and has run without strict since; `docs/spawn-architecture.md` already recommends option **B** (drop
it) and asks for a spike to confirm coexistence first — the table above is that spike.

Under CLAUDE.md's "MulmoClaude is the reference host", two hosts driving the same `~/mulmoclaude`
must not present opposite MCP surfaces with nothing saying the divergence is deliberate.

## Delete the flag rather than parameterise it

The tempting shape is a second input to `buildClaudeArgs` — `attachGuiMcp` and `isolateMcp` as
independent decisions. This plan does not do that: no caller would ever pass `isolateMcp: true`, and
a parameter with one value is the weld waiting to be re-made. Removing the flag is what makes the
pairing impossible.

The probe keeps its own `--strict-mcp-config` because its reason is a *different* one, stated and
measured at `rate-limit-probe.ts:140`: it asks one question that needs no tools, and loading the
user's MCP costs 8.0s → 9–15s of startup for nothing. Isolation for speed on a hidden session is not
isolation for scoping on a visible one.

### Three sites, not two

The investigation on #1338 counted two occurrences in source. There are now three — the launcher
chip arrived afterwards:

| site | action |
| --- | --- |
| `agents/claude-args.ts:52` | drop the flag |
| `session/launcher-gui-mcp.ts:71` | drop the flag — CLAUDE.md requires a chip and the cell beside it to be indistinguishable, and fixing only the cell re-creates that drift |
| `agents/rate-limit-probe.ts:151` | **keep**, with its measurement |

## What removing it costs

**Startup time.** Workspace cells and the single view now load the user's MCP servers — the probe's
own numbers, in reverse. Accepted (owner's call, 2026-08-04): MulmoClaude already pays it on the same
workspace, so this is parity rather than a new risk, but cells will be slower for anyone with several
servers configured.

**Duplicate tool names**, for a directory that registered tool groups in its own `.mcp.json`. The
session would then see both `mcp__mt__presentChart` (ours, via `--mcp-config`) and
`mcp__mulmoterminal-render__presentChart` (the group URL, now no longer shut out) — two names for one
action, and a coin flip over which the model calls.

Not reproducible on this machine — `~/mulmoclaude/.mcp.json` is absent, and of 182 projects in
`~/.claude.json` exactly two register anything (both `playwright`), neither of them the workspace. So
it lands only on someone who opted in, which is why it needs fixing by construction rather than by
observation.

## Phase 2 — make the duplicate impossible, not unlikely

The obvious fix — "don't attach the GUI MCP when the directory registered groups" — is **wrong**.
Groups do not cover every tool (`common/toolGroups.ts`: an unclassified tool belongs to no group and
is reachable only through the all-tools URL), and #1188 exists because `spawnBackgroundChat` went
missing exactly that way.

Put the resolution on **our** side of the wire instead. Both URLs are ours:

1. A session that holds the all-tools URL is **recorded at spawn**. `markAllToolsSession` /
   `hasAllGuiTools` already exist (`registry.ts:323`) but learn on first request, so today the answer
   depends on which URL the client happens to connect to first. `carriesFullGuiMcp` is what knows,
   and it knows before the process starts.
2. The group URL then **offers nothing** to such a session, and refuses a tool named anyway — the
   same two-layer shape `mcp/tool-gate.ts` already applies to the worker and group gates.

The group server still connects and still reports itself; it simply has no tools, so the agent has
exactly one name per action. Serving 404 instead would surface as "server failed to connect", which
is a worse lie than "connected, nothing here".

The record must also be **released**, which is the part the log could not express: it was append-only
because "nothing removes one", and that stopped being true here. A session id outlives its process —
one opened in the single view (full GUI MCP whatever its cwd) can be respawned as a
project-directory cell — and a stale claim would stand that cell's groups down with no all-tools url
to serve them instead. Worse than the duplicate. `all-tools-log.ts` gives the file a release marker
replayed in order, the shape `session-tool-groups.ts` already uses; a bare id still reads as a claim,
so existing files keep working. The release fires exactly where the tool-group reset already does,
so a tmux reattach — same process, same url — keeps its claim.

To keep the decision and the record from separating, the three spawn paths call one function that
does both:

```ts
export function claimFullGuiMcp(sessionId: string, attachGuiMcp: boolean, cwd: string | undefined): boolean
```

`carriesFullGuiMcp` stays pure and exported for the specs and for readers; `claimFullGuiMcp` is what
a spawn path asks. Sites: `spawn-claude.ts`, `spawn-codex.ts`, `ws-routes.ts` (launcher chip).

Codex needs it even though `codexGuiMcpServers` already returns the all-tools server *instead of* the
groups when full — the user's own codex config can still register a group, and the marking is what
the group URL reads.

## Tests

- `claude-args.spec.ts` / `full-gui-mcp.spec.ts` pin the flag today; they invert to pin its absence,
  and gain a case that `--mcp-config` is still passed (the failure this must not become is "the
  panel stopped working").
- `tool-gate.spec.ts` — a group offer is empty for an all-tools session, and a named tool is refused
  with a message that says where the tool actually lives.
- A spec that all three spawn paths record the session, so a fourth path that forgets is visible.
- The duplicate cannot be reproduced from this machine's config, so the group-registration case is
  built in a temp directory rather than asserted from the real one.

## Docs

`docs/spawn-architecture.md` carries the A/B decision table and the settings row for the flag — both
record that B was taken, with the measurement and the date. Also the comments that explain the old
behaviour: `claude-args.ts`, `mcp-config.ts` (`fullGuiAllowedTools`), `spawn-claude.ts`,
`ws-routes.ts`, `issue-spawn-options.ts`, `launcher-gui-mcp.ts`.
