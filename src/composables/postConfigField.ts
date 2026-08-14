import { isRecord } from "../../common/isRecord";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

// POST a single config field as a partial update; the server keeps the other fields, so this
// never clobbers them. Returns the server's echoed value for that field (or `{ ok: false }` on
// failure) so each caller can update just its own singleton ref.
//
// Module of its own rather than a private helper inside useAppConfig, because a setting's saver
// belongs next to the ref it writes — the settings that live in their own module (copy-on-select,
// the cockpit line counts, the terminal font family) would otherwise have to route their one save
// through the config composable, which knows nothing else about them.
//
// `unknown`, not a caller-named `T`: this is the server's echo, and a type argument would let each
// caller DECLARE the shape it wanted rather than check it.
export async function postConfigField(field: string, value: unknown): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    const res = await fetchWithTimeout("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) return { ok: false };
    const body: unknown = await res.json();
    return { ok: true, value: isRecord(body) ? body[field] : undefined };
  } catch {
    return { ok: false };
  }
}
