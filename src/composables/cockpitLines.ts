import { computed, ref, type ComputedRef } from "vue";
import { sanitizeCockpitLines, DEFAULT_COCKPIT_LINES, type CockpitLines } from "../../common/cockpitLines";
import { postConfigField } from "./postConfigField";

// How far each cockpit-roster line clamps, hydrated from /api/config and read by the grid.
//
// A SINGLETON ref for the same reason activeKeymap is one: the config load happens in
// useAppConfig while the roster that renders from it lives in TerminalGrid, so a per-caller ref
// would leave the grid on the defaults forever. A ref rather than a plain module value because
// hydration is ASYNC and this is read from a template — the roster has to re-render when the
// config arrives, or a configured clamp only takes effect on the next full reload.
const current = ref<CockpitLines>({ ...DEFAULT_COCKPIT_LINES });

export const cockpitLines: ComputedRef<CockpitLines> = computed(() => current.value);

export const setCockpitLines = (input: unknown): void => {
  current.value = sanitizeCockpitLines(input);
};

// The whole object goes each time: the server merges by FIELD, so posting one line count would
// sanitize the other two back to their defaults.
export async function saveCockpitLines(next: CockpitLines): Promise<boolean> {
  const r = await postConfigField("cockpitLines", next);
  if (r.ok) setCockpitLines(r.value);
  return r.ok;
}
