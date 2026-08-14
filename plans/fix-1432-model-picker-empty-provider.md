# fix #1432 — a custom provider shows in the MODEL dropdown but cannot be picked

## What was reported

A DeepSeek provider registered in `~/.mulmoterminal/config.json` appears in the launch form's
MODEL dropdown next to "This directory's default", drawn with a highlighted background — and
neither a click nor the arrow keys will select it. Reproduces every time (4.4.0, Windows, Chrome).

## Root cause

`ModelPicker.vue` renders one `<optgroup>` per ready provider and one `<option>` per model:

```html
<optgroup v-for="provider in readyProviders" :label="provider.label">
  <option v-for="model in sortedModels(provider.models)" …/>
</optgroup>
```

A provider whose `models` is empty therefore renders `<optgroup label="DeepSeek"></optgroup>` —
a **group header with no options**. Chrome draws that as a bold, shaded row that is not clickable
and that arrow keys skip. It looks exactly like a broken option, which is what was filed.

Verified against the real DOM before changing anything:

```
<option value="">This directory's default</option>
<optgroup label="DeepSeek"></optgroup>
```

Two independent paths end in an empty `models`, and **both are silent**:

1. **The built-in presets are OpenRouter-only.** Every entry in `common/modelPresets.ts` carries
   `provider: "openrouter"`, and `presetsForProvider` matches on that id. A provider registered
   under any other id (`deepseek`, `moonshot`, an in-house gateway) starts with zero models, so it
   MUST list `models` — and `server/skills/mulmoterminal-model/SKILL.md` said the opposite:
   *"Do not write a `models` array … registering the provider is enough"*, which is true only for
   the id `openrouter`.
2. **A malformed `models` entry is dropped without a word.** `providerSchema.models` filters
   anything that is not a usable model-id string and `.catch([])`s a non-array — so
   `models: [{ "id": "deepseek-chat" }]` or `models: { … }` becomes `[]`, and nothing anywhere
   says so.

A session cannot start on a provider with no model anyway (`resolveProvider` refuses a named
provider without a model), so such a provider is not a choice — it is a setup problem.

## The fix

- **`src/components/launchOffer.ts` (new)** — one rule for what the picker offers:
  `isOfferable = ready && models.length > 0`, and `notOfferedReason()`, the one sentence to show
  about a provider that is not offered (the server's own refusal, or "has no models to pick").
- **`ModelPicker.vue`** — offer only offerable providers, so an empty `<optgroup>` can no longer
  be rendered; show the select only when something is offerable; the help link reads
  **"Needs attention"** when a configured provider is not offered, so the explanation is findable
  even while another provider works.
- **`ModelSetupHelp.vue`** — the "Needs attention" block covers the no-models case too, and the
  setup copy says presets exist only for the id `openrouter`.
- **`server/config/app-config.ts`** — warn once, naming the ids, when a provider's `models`
  entries are dropped. Otherwise the UI says "no models" while the user is looking at a config
  file that lists some.
- **Docs / skill** — `mulmoterminal-model` skill, `docs/guide/{en,ja}/providers.md`.

## Tests

- `test/src/components/launchOffer.spec.ts` — the rule and the sentences.
- `ModelPicker.spec.ts` — a models-less provider is not offered; **no `<optgroup>` is ever empty**
  (the regression, written against the shape rather than one payload); the select hides when the
  only provider has no models; the help link says "Needs attention"; the help explains it.
- `launch-options.spec.ts` — a provider whose id is not `openrouter` gets no presets (the rule
  that made this reachable), and its option is well-formed.
- `app-config.spec.ts` — the dropped ids are named in the warning, and a non-array `models` is
  reported rather than silently emptied.

## Not part of this fix

The two console errors in the report:

- `GET /api/dir-sound?… → 404` is **by design** — the route 404s when the directory has no custom
  sound, and the client falls back to the global sound, then the built-in chime.
- `426 Upgrade Required` is not emitted anywhere in this repo: every `WebSocketServer` runs in
  `noServer` mode (`ws` only sends 426 from its own standalone `port` server). It cannot disable
  a `<select>` option either. Left for the reporter to confirm with the failing request's URL.
