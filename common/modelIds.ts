// The shape a provider id or model id is allowed to take.
//
// Shared because the same string is checked in three places that must agree: the config
// schema that accepts it, the launch picker that offers it, and the ws query that carries
// it to `claude --model` and ANTHROPIC_MODEL. When those disagree, a config-accepted id is
// dropped at launch — and a dropped *provider* with its model kept would start the session
// on Anthropic instead, which is exactly the silent-wrong-backend this feature exists to
// prevent.
//
// The two kinds diverge in exactly one allowance — Claude Code's `[1m]` suffix, which a
// model name may carry and a provider id may not — and share `BASE_ID_RE` for everything
// else, so the part that keeps a value safe in argv cannot drift between them.
//
// Vendor ids in the wild: `moonshotai/kimi-k2.7-code`, `gpt-5.6-luna-pro`, `z-ai/glm-5.2`,
// `~anthropic/claude-opus-latest`.
export const MODEL_ID_MAX_LENGTH = 120;

// No leading dash (argv would read it as another flag), no whitespace, no control
// characters, and no `|` — the picker joins provider and model with it.
//
// A leading `~` IS allowed: OpenRouter's "always the latest" aliases are named that way
// (`~anthropic/claude-opus-latest`, `~moonshotai/kimi-latest` — 10 of them in the live
// catalog), and unlike `-` it means nothing to an argument parser. Checked against all 342
// catalog ids: none is rejected by this shape.
const BASE_ID_RE = /^[A-Za-z0-9~][A-Za-z0-9._:/~-]*$/;

// Claude Code's extended-context syntax: `opus[1m]`, `opusplan[1m]`, `claude-opus-5[1m]`.
// The CLI reads it and strips it before the id reaches the provider, so it is part of a
// model NAME here and is passed to `claude --model` verbatim — re-deciding what it means
// would be this repo owning a rule it does not own (#1503).
//
// It is the only bracketed suffix that exists, which is why this is a literal and not a
// character class: the effort level is a separate `effort` setting, not a name suffix.
// https://code.claude.com/docs/en/model-config#extended-context
const EXTENDED_CONTEXT_SUFFIX = "[1m]";

const withoutExtendedContext = (value: string): string => (value.endsWith(EXTENDED_CONTEXT_SUFFIX) ? value.slice(0, -EXTENDED_CONTEXT_SUFFIX.length) : value);

// A provider's `id` is a key the user invents for their own `providers[]` entry, so the
// suffix means nothing on one. Same base shape as a model id, minus that allowance.
export const isUsableProviderId = (value: string): boolean => value.length <= MODEL_ID_MAX_LENGTH && BASE_ID_RE.test(value);

// The length is measured on the WHOLE value, suffix included — that is what reaches argv.
export const isUsableModelId = (value: string): boolean => value.length <= MODEL_ID_MAX_LENGTH && BASE_ID_RE.test(withoutExtendedContext(value));

// What to tell someone whose id was refused. Lives beside the rule because the two drifted
// apart the moment they were written twice: `~` was added to the shape and the refusal went
// on listing the old set.
export const MODEL_ID_ALLOWED = `letters, digits and . _ : / - ~, plus an optional ${EXTENDED_CONTEXT_SUFFIX} suffix`;
