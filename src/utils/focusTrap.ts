// What counts as focusable inside a modal. Every form control the modals actually use is
// listed, because an element the trap can't see is one Tab can leave the dialog through
// when it happens to sit first or last — `select` was missing while the settings modal
// grew one.
export const MODAL_FOCUSABLE = 'button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Keep Tab focus inside `container`: on Tab from the last focusable element wrap to
// the first, and on Shift+Tab from the first wrap to the last — so focus can't reach
// background controls behind a modal. Call from a keydown handler on a "Tab" event.
// `selector` picks the focusable elements; disabled ones are excluded.
export function trapTabKey(e: KeyboardEvent, container: HTMLElement, selector = 'button, [tabindex]:not([tabindex="-1"])'): void {
  const focusable = [...container.querySelectorAll<HTMLElement>(selector)].filter((el) => !el.hasAttribute("disabled"));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return; // unreachable: the length check above answered
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
