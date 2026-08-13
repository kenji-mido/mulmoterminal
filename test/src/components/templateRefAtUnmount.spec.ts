import { describe, it, expect } from "vitest";
import { createApp, defineComponent, h, onUnmounted, ref } from "vue";

// Why Terminal.vue keeps its own handle on the element it attached instead of reading the template
// ref in `onUnmounted` (#1178): Vue clears template refs while unmounting the subtree, so the hook
// reads null — and null is the one argument that skips detach's "a newer attach already took over
// this slot" guard, which made every unmount unconditional.
//
// Pinned rather than described, because the day this stops being true is the day the workaround
// can go, and nothing else would say so.
describe("a template ref inside onUnmounted", () => {
  it("is already null", () => {
    const seen: Array<HTMLElement | null> = [];
    const Probe = defineComponent({
      setup() {
        const el = ref<HTMLElement | null>(null);
        onUnmounted(() => seen.push(el.value));
        return () => h("div", { ref: el }, "terminal");
      },
    });
    const app = createApp(Probe);
    app.mount(document.createElement("div"));
    app.unmount();
    expect(seen).toEqual([null]);
  });
});
