// The polling lifecycle `useGitStatus` and `useWorkItem` share. Extracted because jscpd found them
// duplicating it (alert #141) — and the two had already drifted: only one of them listened for
// `visibilitychange`, so the other showed stale data until its next tick after a tab switch.
//
// Both returning signals are pinned here, because that drift is exactly what one shared definition
// is supposed to make impossible.
import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

import { usePollWhileVisible } from "../../../src/composables/usePollWhileVisible";

const INTERVAL_MS = 10_000;

function mountPoller(intervalMs = INTERVAL_MS) {
  const refresh = vi.fn();
  const wrapper = mount(
    defineComponent({
      setup() {
        usePollWhileVisible(refresh, intervalMs);
        return () => h("div");
      },
    }),
  );
  return { wrapper, refresh };
}

/** jsdom reports "visible" by default; this is how a hidden tab is simulated. */
const setVisibility = (state: "visible" | "hidden") => Object.defineProperty(document, "visibilityState", { value: state, configurable: true });

afterEach(() => {
  vi.useRealTimers();
  setVisibility("visible");
});

describe("usePollWhileVisible", () => {
  it("refreshes once on mount", () => {
    const { refresh } = mountPoller();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  // Window / app switching.
  it("refreshes when the window regains focus", () => {
    const { refresh } = mountPoller();
    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  // BROWSER TAB switching fires this and not `focus` — the signal `useGitStatus` was missing.
  it("refreshes when the tab becomes visible again", () => {
    const { refresh } = mountPoller();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  // A tab going HIDDEN fires visibilitychange too; polling a backgrounded grid per cell is the
  // cost this guard exists to avoid.
  it("does not refresh when the tab is going hidden", () => {
    const { refresh } = mountPoller();
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1); // the mount call only
  });

  it("refreshes on the interval while visible, and not while hidden", () => {
    vi.useFakeTimers();
    const { refresh } = mountPoller();
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);

    setVisibility("hidden");
    vi.advanceTimersByTime(INTERVAL_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  // A grid unmounts cells constantly. A listener or timer surviving one is a leak that keeps
  // fetching for a directory nobody is looking at.
  it("stops listening and ticking when the component unmounts", () => {
    vi.useFakeTimers();
    const { wrapper, refresh } = mountPoller();
    wrapper.unmount();
    refresh.mockClear();

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(INTERVAL_MS * 3);

    expect(refresh).not.toHaveBeenCalled();
  });
});
