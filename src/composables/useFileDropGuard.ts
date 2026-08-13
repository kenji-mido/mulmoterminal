import { dragCarriesFiles } from "../components/dropPaths";

// A file dropped onto the page navigates the whole tab to that file by default —
// losing every live session. The terminal body turns a file drop into an inserted
// path, but an imprecise ("うっかり") drop lands outside it — the header, a gutter,
// the background — where nothing stops the browser. This window-level net
// preventDefaults every file drag anywhere, so no drop can navigate; the terminal's
// own handler runs first (events bubble child→window) and still inserts the path on
// the happy path. Gated on dragCarriesFiles so it only touches external file drags,
// never an in-app element drag.
type DragTarget = Pick<Window, "addEventListener" | "removeEventListener">;

// The drag's `dataTransfer.types`, or none. Read off the Event structurally rather than declaring
// it a DragEvent: `addEventListener` types its listener with the base `Event`, and `instanceof
// DragEvent` is not an option — jsdom (and any non-browser host) does not define the constructor,
// so the check would throw where the old assertion merely lied.
const dragTypesOf = (event: Event): readonly string[] => {
  const dataTransfer: unknown = Reflect.get(event, "dataTransfer");
  if (!dataTransfer || typeof dataTransfer !== "object") return [];
  const types: unknown = Reflect.get(dataTransfer, "types");
  return Array.isArray(types) ? types.filter((type): type is string => typeof type === "string") : [];
};

export function installFileDropGuard(target: DragTarget = window): () => void {
  const guard = (event: Event) => {
    if (dragCarriesFiles(dragTypesOf(event))) event.preventDefault();
  };
  target.addEventListener("dragover", guard);
  target.addEventListener("drop", guard);
  return () => {
    target.removeEventListener("dragover", guard);
    target.removeEventListener("drop", guard);
  };
}
