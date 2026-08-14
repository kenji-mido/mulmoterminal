import { computed, ref, type ComputedRef } from "vue";
import { DEFAULT_TERMINAL_SUBMIT_MODE, isTerminalSubmitMode, type TerminalSubmitMode } from "../../common/terminalSubmit";
import { postConfigField } from "./postConfigField";

// The active submit/newline byte mapping, hydrated from /api/config and read by every terminal's
// key handler at keydown time.
//
// A ref rather than the plain module value this used to be: Settings now renders the choice. The
// key handler still reads it imperatively through the getter, which is also what keeps this module
// free of xterm imports.
const currentMode = ref<TerminalSubmitMode>(DEFAULT_TERMINAL_SUBMIT_MODE);

export const terminalSubmitMode: ComputedRef<TerminalSubmitMode> = computed(() => currentMode.value);

export const getTerminalSubmitMode = (): TerminalSubmitMode => currentMode.value;

export const setTerminalSubmitMode = (mode: TerminalSubmitMode): void => {
  currentMode.value = mode;
};

export async function saveTerminalSubmitMode(mode: TerminalSubmitMode): Promise<boolean> {
  const r = await postConfigField("terminalSubmit", mode);
  if (r.ok) setTerminalSubmitMode(isTerminalSubmitMode(r.value) ? r.value : DEFAULT_TERMINAL_SUBMIT_MODE);
  return r.ok;
}
