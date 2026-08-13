// The keyboard contract every modal in the app follows: Escape closes it, and Tab stays inside it
// so focus can't reach the controls behind the backdrop. Written out once per dialog until #1289,
// which is how one of them ended up trapping a different set of elements than the others.
//
// Two layers because the dialogs differ in WHEN they listen, not in what they do: SettingsModal and
// ModelSetupHelp exist only while open, so they listen for their whole lifetime; CopyCodeBlock opens
// on demand and TimelineOverlay is driven by a watch, so those two keep their own add/remove and
// take the handler alone.
import { onMounted, onUnmounted, nextTick } from "vue";
import { trapTabKey } from "../utils/focusTrap";

// Read-only, and structural rather than `Ref`: the dialogs declare their root as `ref<HTMLElement>()`
// and as `ref<HTMLElement | null>(null)`, which are two Ref types a writable parameter can't take both of.
type ModalElement = { readonly value: HTMLElement | null | undefined };

interface ModalKeyboardOptions {
  modalEl: ModalElement;
  onClose: () => void;
  /** What Tab may reach inside the dialog. Omitted leaves trapTabKey's own (buttons + tabindex). */
  trapSelector?: string;
}

/** The handler itself, for a dialog that manages its own listener. Bind it to the DOCUMENT rather
 *  than to the dialog element: bound to the element it only fires while focus is already inside,
 *  so one click on the backdrop would kill Escape. */
export function modalKeydownHandler({ modalEl, onClose, trapSelector }: ModalKeyboardOptions): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key !== "Tab" || !modalEl.value) return;
    trapTabKey(e, modalEl.value, trapSelector);
  };
}

/** The same handler, listening for as long as the component is mounted, plus the initial focus that
 *  makes the trap reachable from the keyboard at all. */
export function useModalKeyboard(options: ModalKeyboardOptions & { focusSelector: string }): void {
  const onKeydown = modalKeydownHandler(options);
  onMounted(() => {
    document.addEventListener("keydown", onKeydown);
    void nextTick(() => options.modalEl.value?.querySelector<HTMLElement>(options.focusSelector)?.focus());
  });
  onUnmounted(() => document.removeEventListener("keydown", onKeydown));
}
