/**
 * Make Enter mean "confirm the IME candidate" while a Japanese / Chinese / Korean composition is
 * open, and "the user pressed Enter" only after it closes.
 *
 * Ported from MulmoClaude's `src/composables/useImeAwareEnter.ts`, which the same input problem
 * produced there first (its ChatInput, PageChatComposer and manageRoles edit-name field all use
 * it). Kept the same shape deliberately: someone running both apps must not get two behaviours
 * from one keypress, and the Safari reasoning below is the part that is easy to re-derive wrongly.
 *
 * The `isComposing` guard alone is not enough. **Safari fires `compositionend` BEFORE the
 * confirming Enter's `keydown`**, so `event.isComposing` is already `false` when the handler runs
 * and the naive guard lets the action through — on Chrome and Firefox `compositionend` comes after
 * and `isComposing` is still true, which is why those two look correct without any of this. A tight
 * window after `compositionend` covers the Safari case: that sequence is synchronous (microseconds),
 * while a human pressing Enter a second time takes >= 100ms and never lands inside it.
 */
export const SAFARI_IME_RACE_WINDOW_MS = 30;

export interface ImeAwareEnterHandlers {
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onKeydown: (event: KeyboardEvent) => void;
  onBlur: () => void;
  /**
   * True when this keydown is (or is likely) an IME confirmation rather than a deliberate
   * keypress. Exposed so ANOTHER key on the same field can ask — the memo input's Escape uses it,
   * because Escape mid-composition means "drop this candidate", not "abandon what I typed".
   */
  isImeConfirmation: (event: KeyboardEvent) => boolean;
}

export function useImeAwareEnter(onEnter: () => void, now: () => number = () => performance.now()): ImeAwareEnterHandlers {
  let isImeComposing = false;
  let lastCompositionEndAt = 0;

  function isImeConfirmation(event: KeyboardEvent): boolean {
    if (event.isComposing || isImeComposing) return true;
    return now() - lastCompositionEndAt < SAFARI_IME_RACE_WINDOW_MS;
  }

  return {
    isImeConfirmation,
    onCompositionStart() {
      isImeComposing = true;
    },
    onCompositionEnd() {
      isImeComposing = false;
      lastCompositionEndAt = now();
    },
    onBlur() {
      isImeComposing = false;
      lastCompositionEndAt = 0;
    },
    onKeydown(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.shiftKey) return;
      if (isImeConfirmation(event)) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      onEnter();
    },
  };
}
