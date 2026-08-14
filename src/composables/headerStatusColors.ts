import { computed, ref, type ComputedRef } from "vue";
import {
  sanitizeHeaderStatusColors,
  sanitizeHeaderStatusTint,
  DEFAULT_HEADER_STATUS_TINT,
  type HeaderStatusColors,
  type HeaderStatusTint,
} from "../../common/headerStatusColors";

// The DEFAULT header status colours for every directory, hydrated from /api/config (#1617).
//
// A SINGLETON ref for the reason cockpitLines is one: hydration happens in useAppConfig while
// every cell header reads it, so a per-caller ref would leave the grid on the built-ins forever.
// A ref rather than a plain value because hydration is ASYNC and this is read from a style
// binding — a configured colour has to repaint when the config lands, not on the next reload.
const colors = ref<HeaderStatusColors>({});
const tint = ref<HeaderStatusTint>(DEFAULT_HEADER_STATUS_TINT);

export const globalHeaderStatusColors: ComputedRef<HeaderStatusColors> = computed(() => colors.value);
export const globalHeaderStatusTint: ComputedRef<HeaderStatusTint> = computed(() => tint.value);

export const setHeaderStatusDefaults = (rawColors: unknown, rawTint: unknown): void => {
  colors.value = sanitizeHeaderStatusColors(rawColors);
  tint.value = sanitizeHeaderStatusTint(rawTint) ?? DEFAULT_HEADER_STATUS_TINT;
};
