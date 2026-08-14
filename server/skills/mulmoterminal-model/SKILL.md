---
name: mulmoterminal-model
description: Run MulmoTerminal sessions on something other than Anthropic's default, three ways — register an Anthropic-compatible backend (OpenRouter, Moonshot, a local Ollama bridge, a company gateway) as a `providers` entry in `~/.mulmoterminal/config.json`, which has no Settings UI; pin a `provider` / `model` per project in its `.mulmoterminal.json`; or add a `customAgents` entry, your OWN command line for starting Claude Code (`ollama launch claude --model … --`, a wrapper script, a pinned binary), which then appears in the Agent Picker beside Claude / Codex / Antigravity / Grok / Shell and gets Claude Code's own arguments appended. Knows the measured pass rates of the built-in model list, and the misconfigurations that break a session in ways that are hard to diagnose from inside it (a trailing `/v1`, too small an output budget, an API key written to disk, a provider named but never registered, a custom agent that swallows the arguments it is handed). Use when the user wants to use OpenRouter, Kimi, GLM, DeepSeek, Qwen, a local or self-hosted model, a cheaper model, a different Anthropic model for one project, or to launch Claude Code through a command of their own — or when a session refuses to start, returns empty replies, or 404s after they changed models.
---

# Run on another model

Three keys, three jobs:

- **`~/.mulmoterminal/config.json` → `providers`** — register a backend once. No Settings UI.
- **`<project>/.mulmoterminal.json` → `provider` / `model`** — what this project launches on.
  Both are defaults; the launch form can override them for a single session.
- **`~/.mulmoterminal/config.json` → `customAgents`** — the user's own COMMAND for starting Claude
  Code, offered in the Agent Picker. For when the model is reached by running something else
  (`ollama launch claude …`, a wrapper script, a second Claude Code install) rather than by an
  HTTP endpoint. No Settings UI.

None is needed to use Anthropic's default. Only do this when the user asked for another model.

**Which one.** A backend that speaks the Anthropic API over HTTP is a `providers` entry — that is
the smaller change and it composes with the model picker. Reach for `customAgents` only when the
thing that runs the model is a **command**, and the user cannot express it as a base URL and a
token.

## Registering a backend

```json
{
  "providers": [
    {
      "id": "openrouter",
      "label": "OpenRouter",
      "baseUrl": "https://openrouter.ai/api",
      "tokenEnv": "OPENROUTER_API_KEY",
      "maxOutputTokens": 16000
    }
  ]
}
```

Each rule below was measured against a working setup, and each breaks the session in a way that is
hard to diagnose from inside it:

- **`baseUrl` must not end in `/v1`.** Claude Code appends `/v1/messages` itself, so a trailing
  `/v1` produces `/v1/v1/messages` and every request 404s.
- **Never write the API key into a config or skill file.** `tokenEnv` is the **name** of an
  environment variable, not the value: the key reaches the server through its environment. Put it
  in the shell that starts the server, or in a `.env` in the directory it is started from — and if
  you write a `.env`, check it is gitignored before you do. If the user pastes a key at you, tell
  them where it goes; do not store it anywhere yourself.
- **Keep `maxOutputTokens` at 16000 or above.** A thinking model given less spends the whole budget
  thinking and returns empty visible text, which reads as a hung session.
- **`models` is REQUIRED under any `id` other than `openrouter`.** Every preset in
  `common/modelPresets.ts` carries `provider: "openrouter"`, and they are matched by that id — so a
  backend registered as `deepseek`, `moonshot` or a company gateway starts with **no models at
  all**, and a provider with no models is not offered in the picker (it cannot start a session
  either: naming a provider without a model is refused at spawn). Ask which model ids the user
  wants to run and list them.
- **Under the id `openrouter`, do not write a `models` array** unless the user names a model outside
  the built-in list — every preset appears in the picker on its own, with its measured pass rate,
  and `models` there exists only to ADD ids nobody has measured.
- **A model id is letters, digits and `. _ : / - ~`, optionally ending in `[1m]`.** Anything else in
  `models` — an object like `{"id": "…"}`, a value with a space, a `models` that is not an array — is
  dropped when the config loads, leaving a backend that lists models in the file and offers none in
  the picker. The server log names what it dropped; check it after writing.
- **`[1m]` is Claude Code's extended-context syntax, and the only bracketed suffix there is.** It
  goes to `claude --model` verbatim — Claude Code strips it before the id reaches the backend, so
  nothing on this side interprets it. Valid on an alias or a full name (`opus[1m]`, `opusplan[1m]`,
  `claude-opus-5[1m]`), refused anywhere but the end, and refused in invented forms like `[2m]` or
  `[200k]`. A **provider** `id` may not carry it. Only suggest it when the user asks for the 1M
  window: on Opus 5 / Sonnet 5 the Anthropic API already runs 1M, so it changes nothing there —
  the models it decides for are Opus 4.6 / 4.8 and Sonnet 4.6, and a gateway serving Sonnet 5.
  <https://code.claude.com/docs/en/model-config#extended-context>
- This is a **partial `POST /api/config` merge** — write only `providers`. Send the array **complete**
  (existing entries included): it replaces rather than appends.
- The server reads the environment **at startup**: after adding a key, it has to be restarted.

## Your own way of starting Claude Code — `customAgents`

For a model that is reached by **running a command** rather than by calling an endpoint. The entry
becomes a button in the **Agent Picker** — the Claude / Codex / Antigravity / Grok / Shell toggle at the
top of an empty cell — and picking it starts a real session: resumable transcript, cost and
context, "waiting for you", GUI tools. Global only; no Settings UI.

```json
{
  "customAgents": [
    {
      "id": "nemotron",
      "label": "Nemotron",
      "agent": "claude",
      "command": "ollama launch claude --model nemotron-3-ultra:cloud --"
    }
  ]
}
```

| Key | Meaning |
|---|---|
| `id` | Lowercase slug (`[a-z0-9][a-z0-9_-]*`, ≤ 32 — letters, digits, `-` and `_`). It keys the wire and the session's memory, so **renaming it later is a different agent**; the label is the free one to change. Must not be `claude` / `codex` / `antigravity` / `grok` / `shell` — those are the built-in buttons. |
| `label` | The button's text, ≤ 24 chars. It shares one row with the four built-ins, and that row already wraps in a narrow cell. |
| `agent` | Which agent this launches AS — whose arguments get appended. **`"claude"` is the only value today**, and it is **required**. |
| `command` | The command line, ≤ 500 chars. Run as the program, with that agent's own argv appended. |

Eight entries maximum.

### What actually runs

MulmoTerminal appends **Claude Code's entire argv** to `command`, unchanged — the same one the
`claude` binary would have received:

```
ollama launch claude --model nemotron-3-ultra:cloud -- \
  --session-id <uuid> --settings <hooks JSON> --permission-mode … \
  [--model …] [--mcp-config …] [--allowedTools …] [--add-dir …] [--append-system-prompt …]
```

So the command must **end where Claude Code's own arguments begin**. A wrapper that takes flags of
its own needs the `--` (or whatever it uses) to stop parsing, exactly as in the example above:
`ollama` consumes `--model nemotron-3-ultra:cloud`, and everything after `--` is passed through.

Two consequences worth stating to the user:

- **`--model` is not a conflict.** The wrapper's own `--model` sits before the `--` and is consumed
  by the wrapper; the launch form's model choice arrives after it, for Claude Code. They are
  different arguments to different programs.
- **A wrapper that swallows or reorders what follows breaks the session**, and it breaks it
  quietly: no `--session-id` means no resumable transcript, no `--settings` means the hooks never
  fire so the cell never shows working / waiting, no `--mcp-config` means no GUI tools. If a custom
  agent starts but the cell stays grey and cannot be resumed, this is why — test the command by
  hand with a `--version` after it and check it reaches Claude Code.

### `agent` is required, and why

Nothing in `ollama launch claude --model … --` tells MulmoTerminal which CLI is on the far side of
that `--`. It is declared, never guessed — an entry that omits `agent`, or names one whose argv
this app cannot build, is **dropped on load**, which looks exactly like never having written it.
Audit with `/api/config` rather than assuming a write landed.

### This is not a launcher chip

The two look alike in Settings and are opposites in behaviour. Say which one the user wants:

| | Custom agent (Agent Picker) | Launch command (`launchers`, a chip) |
|---|---|---|
| Runs | your command **+ Claude Code's arguments** | your command, **verbatim** |
| Session | a real agent session — resume, cost, context, waiting status | a plain terminal; recorded as a shell |
| GUI tools / MCP | as any Claude cell | only what your own command asks for |
| Shell syntax | **no** — argv only, no `$VAR`, no pipes, quotes honoured | yes, run through the login shell |

If the user wants a command run and nothing added, that is `launchers` — a Settings section, not
this key.

### Practical notes

- **A partial `POST /api/config` merge**, like `providers`: send `customAgents` **complete**, it
  replaces rather than appends.
- **No restart needed** — the list is read at every spawn, so an added entry reaches the next
  session. But an existing browser tab needs a **reload** to show the new button.
- **A missing program is reported by the child**, not pre-flighted: `CLAUDE_BIN` cannot fix a
  command the user wrote, so the terminal shows the shell's own "command not found" rather than
  this app's binary diagnosis. Check the command exists on `PATH` when a cell dies instantly.
- **Which agent a session was started on is remembered on disk**
  (`~/.mulmoterminal/custom-agent-sessions.jsonl`), so it survives the cell closing, the session
  exiting and a server restart. Resuming a conversation months later still runs it the way it was
  being run.
- **Resuming a conversation keeps the agent it started on, whatever the picker currently says.**
  Picking a custom agent and then clicking a row under *OR RESUME HERE* continues that session as
  it was; the picker only decides what a NEW session starts as. Same rule as the provider/model
  pick. To run an existing conversation on a different agent, start a new session instead.
- Deleting an entry that a live session was started from leaves that session running; the next
  start falls back to plain `claude`.

## Choosing a model — never invent an id

Read `common/modelPresets.ts` in the MulmoTerminal repo and offer what is listed there, **with its
measured pass rate**.

Those numbers are the point. Each entry records how many attempts of a real tool-using task the
model completed — a model can answer fluently, in good prose, and never once call a tool, and that
is indistinguishable from working until you try to get something done. `3/3` and `0/4` are the
difference between a usable session and a broken one, so quote the ratio when you offer a model.

- Prefer entries whose `trials.status` is `measured` with `passed === of`.
- `status: "unreachable"` is **not** a defect in the model — it means the account that ran the
  measurement couldn't reach it (OpenRouter answers 404 when privacy settings exclude every
  provider serving a model). Another account may run it fine; say that rather than hiding it.
- `status: "unmeasured"` means the user added it themselves. Say it is untested.
- If the user names a model that isn't listed, add it to that provider's `models` array rather than
  silently trusting it — and tell them it is unmeasured.
- `medianSeconds` is worth quoting when they care about latency: the same probe ran in 11s on one
  model and 69s on another.

## Pinning a project

```json
{ "provider": "openrouter", "model": "moonshotai/kimi-k2" }
```

| Key | Meaning |
|---|---|
| `provider` | The `id` of a backend registered in `providers`. **Omit to stay on Anthropic.** |
| `model` | Passed to `claude --model`. With no `provider`, this picks a different **Anthropic** model. May end in `[1m]` for the 1M context window (see above). |

**A directory naming a `provider` that isn't registered, or whose key is missing, does not fall
back — its sessions refuse to start.** Check the provider exists in the global config before writing
this, and check the environment variable is actually set in the shell that will run the server.

`.mulmoterminal.json` applies live: writing it with your Write/Edit tool is itself the reload
signal (there is no filesystem watcher). But a **running** session keeps the model it launched with
— reopen the cell to see the change.

## When it doesn't work

Work down this list; each maps to one of the rules above.

| Symptom | Look at |
|---|---|
| Every request 404s | A trailing `/v1` on `baseUrl` |
| Session starts, replies are empty | `maxOutputTokens` below 16000 on a thinking model |
| Session refuses to start | A `provider` id that isn't registered, or `tokenEnv` naming a variable that isn't set in the server's shell |
| The backend is missing from the MODEL dropdown | It has no models to pick — presets exist only under the id `openrouter`, so list `models`. Open "Needs attention" beside the MODEL label for the sentence naming what is missing |
| `models` is in the config and the picker still offers none | Every id in it was refused by the shape rule above. The server's log names them |
| Worked yesterday, not today | The key was in a shell that's gone. The server reads the environment at startup |
| Model answers but never edits files | Not a config problem — check the model's pass rate in `modelPresets.ts` |
| A custom agent's button never appears | The entry was dropped on load — most often no `agent: "claude"`, an `id` that is not a lowercase slug, or one clashing with a built-in. Audit `/api/config`, then reload the tab |
| A custom agent's cell starts but stays grey, or cannot be resumed | The command is swallowing the appended arguments — see "What actually runs" |
| A custom agent's cell dies instantly | The program is not on the server's `PATH`. There is no pre-flight check for a command you wrote; the terminal shows the child's own error |
