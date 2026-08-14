# fix #1423 — Antigravity in the workspace is told it has every GUI tool, and loses the way to get any

## What is wrong

`CellLaunchForm.vue` decides two things from one value:

```ts
const inWorkspace = computed(() => isSameDirPath(targetDir.value, props.defaultCwd));
```

- `v-if="inWorkspace"` → show **"All of them, automatically"**
- its `v-else` → show the four MCP group toggles

The value asks the **directory** and never the **agent**. Pick Antigravity, point at the
workspace, and the form states something untrue and simultaneously removes the only control that
could have made it true.

The comment above that line states the premise out loud, and the premise is what is wrong:

> a session started there is handed the WHOLE GUI MCP on one URL, **whatever agent runs it**

Only two of the three spawn paths consult that predicate:

| spawn | full GUI MCP | how |
|---|---|---|
| `spawn-claude.ts:202` | yes | `carriesFullGuiMcp(attachGuiMcp, cwd)` |
| `spawn-codex.ts:90` | yes | `claimFullGuiMcp(...)` |
| `spawn-antigravity.ts:52` | **no** | `syncAntigravityMcpConfig(cwd, mcpGroups)` only |

`spawn-antigravity.ts` contains no reference to `carriesFullGuiMcp`, `claimFullGuiMcp` or
`isWorkspaceCwd`. Antigravity reads a per-directory config file that names the registered group
servers; being in the workspace changes nothing about it.

And there is no other way out: `applyMcpGroup` / `mcpGroupEnabled` exist in exactly one component
in `src/`, so hiding those toggles removes the capability from the app, not just from the form.

## Which side is wrong

**The UI.** Antigravity being directory-scoped is the intended, documented behaviour — the guide
merged in #1408 says "Antigravity is the exception: wherever it runs, it gets what its directory
registered". Confirmed with the maintainer before implementing. So the form must show the toggles
for Antigravity, in the workspace like anywhere else.

## Why the fix is not just an `&&` in the template

"Which agents are handed the whole GUI MCP in the workspace" is decided by the **server** (by which
spawn calls the predicate) and needed by the **UI** (to choose panel vs toggles). Today the UI
cannot ask — the fact is implicit in which file calls what. That is the exact shape CLAUDE.md sends
to `common/`:

> a value or wire type that BOTH sides decide from … belongs here — never mirrored into `server/`
> and `src/` with a "keep the two copies in sync" comment

So the agent dimension becomes an exported predicate in `common/`, the UI reads it, and
`carriesFullGuiMcp` reads it too — so a fourth agent added later cannot be full-GUI on the server
and toggles-only in the form, or the reverse.

## Plan

1. **`common/guiMcpAgents.ts`** (new)
   - `FULL_GUI_MCP_AGENTS = ["claude", "codex"]` — the agents whose spawn hands over every GUI tool
     when the session runs in the workspace.
   - `agentCarriesFullGuiMcp(agent)` — the predicate both sides call.
   - The comment carries the *reason* Antigravity is out: it reaches MCP through a per-directory
     config file it reads itself, so there is no per-spawn URL to hand it.

2. **`server/session/mcp-config.ts`** — `carriesFullGuiMcp` takes the agent and consults the
   predicate, so the server enforces the same list rather than encoding it by omission.
   Call sites in `spawn-claude.ts` / `spawn-codex.ts` pass their own agent.

3. **`src/components/CellLaunchForm.vue`** — the panel/toggles branch asks
   `inWorkspace && agentCarriesFullGuiMcp(props.agent)`. `inWorkspace` keeps its own meaning
   (used by the worktree row at `:636`), so the agent test goes in a separate named computed
   rather than being folded into it — the worktree row is about the directory, not the agent.

4. **Tests**
   - `common/` spec pinning the membership, including that Antigravity is absent **and why**.
   - Component spec: Antigravity + workspace shows `cell-mcp-toggle-*` and NOT `cell-mcp-all`;
     claude + workspace still shows `cell-mcp-all`; Antigravity in a project directory unchanged.
   - Server spec: `carriesFullGuiMcp` is false for antigravity in the workspace.
   - Each new test re-run with its own fix reverted, to confirm it actually fails.

## Out of scope

Whether Antigravity *should* get every tool in the workspace. That is a feature change, it
contradicts documentation merged hours ago, and the maintainer chose the other direction.
