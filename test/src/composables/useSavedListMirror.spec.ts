import { describe, it, expect, vi } from "vitest";
import { nextTick, ref } from "vue";
import { useSavedListMirror } from "../../../src/composables/useSavedListMirror";

// The four Settings lists (PR repos, cell launchers, phone quick commands, MCP servers) all hold
// an editable copy of a value the parent persists. What is worth pinning is the copy: the whole
// list is saved on every change, so an edit made before the previous save answers has to build on
// the previous edit rather than on the value the props still show.

const mirror = <T>(saved: { value: readonly T[] | undefined }, publish: (next: T[]) => void) => useSavedListMirror<T>(() => saved.value, publish);

describe("useSavedListMirror", () => {
  it("starts from the saved value", () => {
    const saved = ref<string[]>(["a/one", "b/two"]);
    const { items } = mirror(saved, vi.fn());
    expect(items.value).toEqual(["a/one", "b/two"]);
  });

  it("starts empty when nothing is saved yet", () => {
    const { items } = mirror(ref<string[] | undefined>(undefined), vi.fn());
    expect(items.value).toEqual([]);
  });

  it("publishes the whole new list, and shows it immediately", () => {
    const publish = vi.fn();
    const { items, replace } = mirror(ref<string[]>(["a/one"]), publish);
    replace([...items.value, "b/two"]);
    expect(publish).toHaveBeenCalledWith(["a/one", "b/two"]);
    expect(items.value).toEqual(["a/one", "b/two"]);
  });

  // The regression this exists for: two edits made before the first POST answers must compound.
  // The saved value deliberately stays put here — that is what an in-flight save looks like from
  // the component's side, and reading the prop instead of the local copy would drop the first.
  it("compounds edits made before the save lands", () => {
    const publish = vi.fn();
    const saved = ref<string[]>([]);
    const { items, replace } = mirror(saved, publish);
    replace([...items.value, "a/one"]);
    replace([...items.value, "b/two"]);
    expect(publish).toHaveBeenLastCalledWith(["a/one", "b/two"]);
  });

  it("takes the saved value back over when it changes", async () => {
    const saved = ref<string[]>(["a/one"]);
    const { items, replace } = mirror(saved, vi.fn());
    replace([]);
    saved.value = ["c/three"];
    await nextTick();
    expect(items.value).toEqual(["c/three"]);
  });

  it("empties when the saved value goes away", async () => {
    const saved = ref<string[] | undefined>(["a/one"]);
    const { items } = mirror(saved, vi.fn());
    saved.value = undefined;
    await nextTick();
    expect(items.value).toEqual([]);
  });

  // A copy, not the array itself: mutating what the caller handed in — or what it read back —
  // must not reach into the saved value.
  it("copies rather than aliases the saved array", () => {
    const saved = ref<string[]>(["a/one"]);
    const { items } = mirror(saved, vi.fn());
    expect(items.value).not.toBe(saved.value);
  });
});
