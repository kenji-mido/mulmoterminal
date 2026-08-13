// What the Files pane had open, remembered ACROSS RELOADS and keyed by directory (#958).
//
// The in-memory map beside this one is keyed by cell uid and stays that way: two terminals in
// the same repository is the ordinary case, and during a session each should remember its own
// tree. A uid is not the same number after a reload though, so it cannot be what survives one
// — the directory is. The two layers are read memory-first, so nothing about a live session
// changes; the directory layer only answers when the memory layer is empty, which is exactly
// the first look after a reload.
//
// Pure: no localStorage here. The host reads and writes the string through its own best-effort
// storage helpers, which is also what makes this testable without a DOM.
import type { FilesPaneState } from "./FilesPane.vue";
import { isRecord } from "../../common/isRecord";

export interface RememberedPane {
  cwd: string;
  state: FilesPaneState;
}

/** Directories kept, newest first. A browser-wide cap: without one this grows for as long as the
 *  user opens new projects, and localStorage answers a quota error by failing the whole write. */
export const MAX_REMEMBERED_DIRS = 20;

/** Expanded paths kept per directory. One pathological tree (a node_modules walked open) would
 *  otherwise be large enough to cost every OTHER directory its entry. */
export const MAX_EXPANDED_PATHS = 200;

const isPaneState = (value: unknown): value is FilesPaneState => {
  if (!isRecord(value)) return false;
  const { openPath, expanded } = value;
  const openPathOk = openPath === null || typeof openPath === "string";
  return openPathOk && Array.isArray(expanded) && expanded.every((p) => typeof p === "string");
};

/** Both caps applied. Shared by the write and the read so the two cannot drift: a bound only
 *  enforced on write is no bound at all once a value written by another build — or by hand —
 *  is in storage, and `restore()` walks every path in the list. */
const capped = (state: FilesPaneState): FilesPaneState => ({ openPath: state.openPath, expanded: state.expanded.slice(0, MAX_EXPANDED_PATHS) });

const isRemembered = (value: unknown): value is RememberedPane => {
  if (!isRecord(value)) return false;
  const { cwd, state } = value;
  return typeof cwd === "string" && cwd !== "" && isPaneState(state);
};

/** Read back what was stored. Anything unparseable or the wrong shape is dropped rather than
 *  thrown: this is a convenience, and a bad entry must not cost the user a working pane. */
export function parsePaneStore(raw: string | null): RememberedPane[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isRemembered)
      .slice(0, MAX_REMEMBERED_DIRS)
      .map((entry) => ({ cwd: entry.cwd, state: capped(entry.state) }));
  } catch {
    return []; // not JSON at all — a foreign or half-written value
  }
}

/** `store` with `cwd` recorded at the front, its previous entry removed. Newest-first order is
 *  what makes the cap an LRU rather than an arbitrary truncation. */
export function rememberPane(store: RememberedPane[], cwd: string, state: FilesPaneState): RememberedPane[] {
  return [{ cwd, state: capped(state) }, ...store.filter((entry) => entry.cwd !== cwd)].slice(0, MAX_REMEMBERED_DIRS);
}

/** What this directory had open, or null when it is not remembered. */
export function recallPane(store: RememberedPane[], cwd: string | null): FilesPaneState | null {
  if (!cwd) return null;
  return store.find((entry) => entry.cwd === cwd)?.state ?? null;
}
