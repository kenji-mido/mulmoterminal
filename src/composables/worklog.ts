import { computed, ref, type ComputedRef } from "vue";
import { DEFAULT_WORKLOG_INTERVAL_HOURS, sanitizeWorklogIntervalHours } from "../../common/worklogInterval";
import { createGlobalFlag } from "./globalFlag";
import { postConfigField } from "./postConfigField";

// The periodic dev-work log: a built-in scheduled task that summarizes recent work across the
// saved working dirs into weekly wiki pages. Off by default — each run spawns an LLM session, so
// it costs tokens.
//
// The switch and the cadence are two config keys but one feature, so they share a module: a reader
// asking "how often" is always the same reader who just turned it on.
const flag = createGlobalFlag("worklogEnabled", false);

export const worklogEnabled = flag.state;
export const setWorklogEnabled = flag.set;
export const saveWorklogEnabled = flag.save;

const intervalHours = ref(DEFAULT_WORKLOG_INTERVAL_HOURS);

export const worklogIntervalHours: ComputedRef<number> = computed(() => intervalHours.value);

export const setWorklogIntervalHours = (value: unknown): void => {
  intervalHours.value = sanitizeWorklogIntervalHours(value);
};

export async function saveWorklogIntervalHours(hours: number): Promise<boolean> {
  const r = await postConfigField("worklogIntervalHours", sanitizeWorklogIntervalHours(hours));
  if (r.ok) setWorklogIntervalHours(r.value);
  return r.ok;
}
