import { computed, ref, type ComputedRef } from "vue";
import { isUnknownArray } from "../../common/isUnknownArray";

// How many global header buttons and chips the config declares, for Settings to report.
//
// Counts rather than the entries themselves, deliberately: Settings does not render a button here,
// it says whether any are configured and hands the editing to `mulmoterminal-header`. Keeping the
// entries would mean a second client-side guard for the CONFIG shape of a button (`cmd`, `when`),
// which differs from the RESOLVED shape /api/header returns and that useHeaderButtons already
// guards — two guards for one concept is how they drift.
//
// `null` is not zero: it means the key is unconfigured, so the built-in defaults apply. An empty
// array is a user who removed every button, and the header is genuinely bare.
const buttons = ref<number | null>(null);
const chips = ref<number | null>(null);

export const headerButtonCount: ComputedRef<number | null> = computed(() => buttons.value);
export const headerChipCount: ComputedRef<number | null> = computed(() => chips.value);

const countOf = (value: unknown): number | null => (isUnknownArray(value) ? value.length : null);

export const setHeaderConfigSummary = (c: { buttons?: unknown; chips?: unknown }): void => {
  buttons.value = countOf(c.buttons);
  chips.value = countOf(c.chips);
};
