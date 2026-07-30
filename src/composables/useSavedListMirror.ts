import { shallowRef, watch } from "vue";

// An editable copy of a list the parent persists, for the Settings lists (PR repos, cell
// launchers, phone quick commands, MCP servers). Each edit hands the WHOLE new list up.
//
// It has to be a LOCAL copy and not the prop itself: the whole list is persisted on every
// change, so two edits made before the first POST answers would both compute from the same
// pre-save snapshot, and the second would drop the first.
//
// `shallowRef` rather than `ref`: the list is always replaced wholesale, never mutated in
// place, and a generic `ref<T[]>` needs a cast to shake off UnwrapRef.
export function useSavedListMirror<T>(saved: () => readonly T[] | undefined, publish: (next: T[]) => void) {
  const items = shallowRef<T[]>([...(saved() ?? [])]);
  watch(saved, (next) => (items.value = [...(next ?? [])]));

  function replace(next: T[]): void {
    items.value = next;
    publish(next);
  }

  return { items, replace };
}
