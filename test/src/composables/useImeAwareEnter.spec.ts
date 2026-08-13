// What Enter means while an IME candidate is open. The naive `isComposing` guard is right on
// Chrome and Firefox and WRONG on Safari, which fires `compositionend` before the confirming
// keydown — so the interesting cases here are the ones where `isComposing` is already false.
import { describe, it, expect, vi } from "vitest";

import { useImeAwareEnter, SAFARI_IME_RACE_WINDOW_MS } from "../../../src/composables/useImeAwareEnter";

const key = (over: Partial<KeyboardEvent> = {}): KeyboardEvent => {
  const preventDefault = vi.fn();
  return { key: "Enter", shiftKey: false, isComposing: false, preventDefault, ...over } as unknown as KeyboardEvent;
};

// A clock the test drives, so "30ms later" is exact rather than a sleep.
const clock = () => {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe("useImeAwareEnter", () => {
  it("runs the action on a plain Enter", () => {
    const onEnter = vi.fn();
    const ime = useImeAwareEnter(onEnter, clock().now);
    const e = key();

    ime.onKeydown(e);

    expect(onEnter).toHaveBeenCalledOnce();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  // Chrome and Firefox: `isComposing` is still true on the confirming keydown.
  it("does not run the action when the event is still composing", () => {
    const onEnter = vi.fn();
    const ime = useImeAwareEnter(onEnter, clock().now);

    ime.onKeydown(key({ isComposing: true }));

    expect(onEnter).not.toHaveBeenCalled();
  });

  // The same, driven by compositionstart rather than the flag on the event.
  it("does not run the action between compositionstart and compositionend", () => {
    const onEnter = vi.fn();
    const ime = useImeAwareEnter(onEnter, clock().now);

    ime.onCompositionStart();
    ime.onKeydown(key());

    expect(onEnter).not.toHaveBeenCalled();
  });

  // Safari: compositionend has ALREADY fired, so `isComposing` is false and the naive guard would
  // let this through. This is the case the window exists for — deleting it turns this red.
  it("does not run the action on the keydown that immediately follows compositionend", () => {
    const onEnter = vi.fn();
    const c = clock();
    const ime = useImeAwareEnter(onEnter, c.now);

    ime.onCompositionStart();
    ime.onCompositionEnd();
    ime.onKeydown(key({ isComposing: false }));

    expect(onEnter).not.toHaveBeenCalled();
  });

  it("runs the action on a second Enter once the race window has passed", () => {
    const onEnter = vi.fn();
    const c = clock();
    const ime = useImeAwareEnter(onEnter, c.now);

    ime.onCompositionStart();
    ime.onCompositionEnd();
    c.advance(SAFARI_IME_RACE_WINDOW_MS);

    ime.onKeydown(key());

    expect(onEnter).toHaveBeenCalledOnce();
  });

  it("leaves other keys alone", () => {
    const onEnter = vi.fn();
    const ime = useImeAwareEnter(onEnter, clock().now);
    const e = key({ key: "a" });

    ime.onKeydown(e);

    expect(onEnter).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves Shift+Enter alone", () => {
    const onEnter = vi.fn();
    const ime = useImeAwareEnter(onEnter, clock().now);
    const e = key({ shiftKey: true });

    ime.onKeydown(e);

    expect(onEnter).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  // Otherwise a composition abandoned by clicking away leaves the flag set, and the next Enter in
  // a freshly-opened box does nothing.
  it("forgets an unfinished composition on blur", () => {
    const onEnter = vi.fn();
    const c = clock();
    const ime = useImeAwareEnter(onEnter, c.now);

    ime.onCompositionStart();
    ime.onBlur();
    ime.onKeydown(key());

    expect(onEnter).toHaveBeenCalledOnce();
  });

  it("clears the race window on blur too", () => {
    const onEnter = vi.fn();
    const c = clock();
    const ime = useImeAwareEnter(onEnter, c.now);

    ime.onCompositionEnd();
    ime.onBlur();
    ime.onKeydown(key());

    expect(onEnter).toHaveBeenCalledOnce();
  });

  describe("isImeConfirmation", () => {
    it("is true mid-composition and inside the window, false outside it", () => {
      const c = clock();
      const ime = useImeAwareEnter(vi.fn(), c.now);

      expect(ime.isImeConfirmation(key({ isComposing: true }))).toBe(true);

      ime.onCompositionStart();
      expect(ime.isImeConfirmation(key())).toBe(true);

      ime.onCompositionEnd();
      expect(ime.isImeConfirmation(key())).toBe(true);

      c.advance(SAFARI_IME_RACE_WINDOW_MS);
      expect(ime.isImeConfirmation(key())).toBe(false);
    });
  });
});
