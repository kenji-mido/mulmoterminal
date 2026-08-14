// How long a session may sit unused before the server ends it at its next start (#1467).
//
// One number, shown beside the list it governs (Settings → Sessions that survived a restart) rather
// than only in config.json: the sweep is the one behaviour here that acts without being asked, and
// a setting nobody can find is how that becomes a surprise.
import { computed, ref, type ComputedRef } from "vue";
import { DEFAULT_REAP_IDLE_DAYS, sanitizeReapIdleDays } from "../../common/sessionReap";
import { postConfigField } from "./postConfigField";

const idleDays = ref(DEFAULT_REAP_IDLE_DAYS);

export const sessionIdleReapDays: ComputedRef<number> = computed(() => idleDays.value);

export const setSessionIdleReapDays = (value: unknown): void => {
  idleDays.value = sanitizeReapIdleDays(value);
};

export async function saveSessionIdleReapDays(days: number): Promise<boolean> {
  const r = await postConfigField("sessionIdleReapDays", sanitizeReapIdleDays(days));
  if (r.ok) setSessionIdleReapDays(r.value);
  return r.ok;
}
