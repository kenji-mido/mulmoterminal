// Which configured backends the launch picker offers, and what to say about the ones it does
// not (#1432).
//
// A provider is a CHOICE only when this server can reach it AND it has at least one model to
// pick: a session named on a provider with no model is refused at spawn, so a provider with an
// empty list is a setup problem rather than an option. Rendering it anyway produced the bug this
// module exists to prevent — an `<optgroup>` with no `<option>` inside, which a browser draws as
// a shaded row that neither a click nor an arrow key can reach.
//
// Shared by the picker and the help so the two cannot disagree about which providers are offered
// and which are explained.
import type { LaunchProviderOption } from "../../common/launchOptions";

export const isOfferable = (provider: LaunchProviderOption): boolean => provider.ready && provider.models.length > 0;

// Why this backend is not in the picker, in one sentence — the server's own refusal when a
// session could not start on it at all, else what is missing. Null when it IS offered.
//
// The no-models wording names the config file and the preset rule because both ends of it are
// invisible from the picker: the built-in list is OpenRouter's alone (every entry in
// common/modelPresets.ts carries `provider: "openrouter"`), so a backend registered under any
// other id has nothing until its `models` are listed.
export function notOfferedReason(provider: LaunchProviderOption): string | null {
  if (!provider.ready) return provider.reason ?? `provider '${provider.id}' cannot be used as configured`;
  if (provider.models.length === 0) {
    return `provider '${provider.id}' has no models to pick — list its model ids under "models" in ~/.mulmoterminal/config.json (only 'openrouter' has built-in presets)`;
  }
  return null;
}
