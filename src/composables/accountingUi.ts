// Wire @mulmoclaude/accounting-plugin/vue to MulmoTerminal. Imported for its side
// effect from main.ts so the package's View can resolve its network / pub-sub / locale
// seams before any manageAccounting card mounts. MulmoTerminal's counterpart to
// MulmoClaude's src/composables/accountingHost.ts — but leaner:
//   · no global `style.css` import: PluginFrame injects the package CSS into each
//     view's own shadow root via the `?inline` string in plugins-registry.ts, so it
//     can't leak the package's Tailwind preflight into MulmoTerminal's own UI.
//   · locale is the browser's base language (MulmoTerminal has no locale picker); the
//     package's self-contained i18n falls back to English for anything else.
import { configureAccountingHost } from "@mulmoclaude/accounting-plugin/vue";
import type { ApiResult } from "@mulmoclaude/accounting-plugin/vue";
import { fetchJson } from "../utils/fetchJson";
import { usePubSub } from "./usePubSub";
import { browserLocale } from "../utils/browserLocale";

const { subscribe } = usePubSub();

// The plugin package declares the generic — `AccountingApiCall = <T = unknown>(path, opts) =>
// Promise<ApiResult<T>>` — so the PLUGIN chooses T and the host has to produce it from a body
// nothing has checked. Unprovable by construction, exactly like gui-chat-protocol's `dispatch<T>`
// (see the type-assertion allowlist in eslint.config.js). The claim is made HERE, at the seam,
// rather than hidden inside fetchJson where it would apply to every caller.
const asDeclared = <T>(raw: unknown): T => raw as T;

// Network seam — normalise fetch into the package's ApiResult union (the View
// pattern-matches on `.ok`). Mirrors MulmoClaude's apiCall shape so the View's
// `apiCall("/api/accounting", { method, body })` calls just work.
function apiCall<T = unknown>(path: string, opts: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown }): Promise<ApiResult<T>> {
  // RequestInit spells its fields exact, so a bodyless call omits both keys rather than
  // sending them as undefined.
  const hasBody = opts.body !== undefined;
  return fetchJson<T>(path, asDeclared, {
    method: opts.method,
    ...(hasBody ? { headers: { "content-type": "application/json" }, body: JSON.stringify(opts.body) } : {}),
  });
}

configureAccountingHost({
  apiCall,
  // Raw `accounting:<bookId>` / `accounting:books` channels: the engine publishes
  // book changes (server/backends/accounting.ts) and the View live-refreshes.
  subscribe,
  localeTag: () => browserLocale(),
});
