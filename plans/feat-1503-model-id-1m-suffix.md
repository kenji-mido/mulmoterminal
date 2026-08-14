# feat: accept Claude Code's `[1m]` extended-context suffix in a model id (#1503)

## The report

`.mulmoterminal.json` holding `{"model": "claude-opus-5[1m]"}` refuses to launch:

```
[unusable model id "claude-opus-5[1m]" — letters, digits and . _ : / - ~ only]
```

`[1m]` is Claude Code's own syntax for asking a model for the 1M context window. The
CLI strips the suffix before the model id reaches the provider, so it never leaves
Claude Code — but MulmoTerminal's id shape rejects `[` and `]`, and every entry point
shares that shape, so there is no way to write it at all.

## What the official docs say

<https://code.claude.com/docs/en/model-config#extended-context>

- Valid on an alias (`opus[1m]`, `sonnet[1m]`, `opusplan[1m]`) and on a full model name
  (`claude-opus-4-8[1m]`).
- Accepted by `/model`, by the `model` setting, and by the `ANTHROPIC_DEFAULT_*_MODEL`
  environment variables.
- "Claude Code strips the suffix before sending the model ID to your provider."
- **`[1m]` is the only bracketed suffix that exists.** The effort level is a separate
  `effort` setting, not a name suffix. Checked against the whole model-config page: 19
  occurrences of `[1m]` and no other bracketed form.

Verified against the CLI rather than the docs alone — `claude --model 'claude-opus-5[1m]'
-p 'Reply with exactly: OK'` on Claude Code 2.1.223 answers `OK` and exits 0, so `--model`
takes it as well as `/model` does.

## Decision

Widen the id shape by exactly the suffix the docs define, and pass the value to
`claude --model` verbatim — stripping it is Claude Code's job, and doing it here would
mean this repo re-deciding a rule it does not own.

The alternative considered and rejected: a separate `contextWindow: "1m"` key that the
server appends at `--model` build time. It cannot be expressed in `providers[].models`,
it adds a third field to `DirModelChoice`, and it means the config file cannot be written
the way the official documentation shows.

### A model id and a provider id stop sharing one predicate

`common/modelIds.ts` currently exports one `isUsableModelId` used for both. The suffix is
meaningless on a provider id — that is a key the user invents for their own `providers[]`
entry — so the base shape stays exactly as it was for provider ids, and only model ids gain
the suffix. Both keep reading the same `BASE_ID_RE`, so the two cannot drift in the part
that matters (no whitespace, no leading dash, no `|`, no control characters).

| Call site | Predicate |
| --- | --- |
| `providerSchema.id` (`server/config/config-schema.ts`) | `isUsableProviderId` |
| `providerSchema.models[]` | `isUsableModelId` |
| ws query `?provider=` (`server/session/launch-choice.ts`) | `isUsableProviderId` |
| ws query `?model=` | `isUsableModelId` |
| `resolveProvider` (`server/session/provider-env.ts`) | `isUsableModelId` |

## Scope

- `common/modelIds.ts` — `BASE_ID_RE`, `EXTENDED_CONTEXT_SUFFIX`, the two predicates, and
  `MODEL_ID_ALLOWED` reworded once so every message stays generated from the rule.
- `server/config/config-schema.ts`, `server/session/launch-choice.ts` — pick the right
  predicate per field.
- `server/session/provider-env.ts` — refusal wording follows `MODEL_ID_ALLOWED`.
- Tests: `test/common/modelIds.spec.ts` (new, the shape itself) and
  `test/server/config/dir-model-choice.spec.ts` (the real load → resolve → argv path).
- Docs: `docs/guide/{en,ja}/providers.md`, `server/skills/mulmoterminal-model/SKILL.md`.
  Dated release pages are snapshots and are left alone.

## Not in scope

- Offering a `[1m]` entry in the launch picker. `MODEL_PRESETS` is measured pass-rate data
  for third-party backends; the picker has no Anthropic-model section to add it to.
- Stripping the suffix out of `ANTHROPIC_MODEL` / `ANTHROPIC_SMALL_FAST_MODEL` on the
  third-party provider path. Claude Code reads those and strips the suffix itself; a
  gateway that wants the 1M window is documented as selecting it exactly this way.
- Codex / Grok / Antigravity model overrides. They come from `CODEX_MODEL` and friends in
  the server's environment and never pass through this shape.
