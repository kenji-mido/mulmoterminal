// Dispatch a header action button. `input` types text into the running session; `open` opens a
// url / reveals a dir / opens the in-app file explorer or a view. `shell` is handled upstream in
// Terminal.vue (it emits `run` to open a command cell), so it never reaches here — the branch below
// is only a defensive no-op warn.
import { filesGotoIndex } from "./useFilesView";
import { prsGotoIndex } from "./usePrsView";
import { wikiGotoIndex } from "./useWikiBrowse";
import { browseGotoIndex } from "./useCollectionBrowse";
import { accountingViewOpen } from "./useAccountingView";
import { submitText, insertText } from "./useTerminalConnections";
import { openTerminalAt } from "./useNewTerminal";
import { toInsertText } from "../components/dropPaths";
import { openFilePicker } from "./useFilePicker";
import { isTouchDevice } from "./touchDevice";
import type { HeaderButton, OpenTarget } from "./useHeaderButtons";

const OPEN_URL_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

// Pick a file and insert its path at the session's cursor. Uses the in-browser picker rather
// than the native OS dialog (/api/pick-file): that dialog opens on the SERVER's display, which
// is unreachable from a remote browser (a phone), and "remote" can't be told from "local"
// client-side (an SSH forward makes a phone look like localhost). slotKey is the target
// terminal; `cwd` seeds where the picker opens (the session's working dir).
function pickFileInto(slotKey: string | null, cwd: string | null): void {
  if (!slotKey) return;
  openFilePicker({ start: cwd, onSelect: (paths) => insertText(slotKey, toInsertText(paths)) });
}

function openUrl(url: string): void {
  try {
    if (OPEN_URL_SCHEMES.has(new URL(url).protocol)) window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    // malformed url — ignore
  }
}

function revealDir(dirPath: string): void {
  fetch("/api/open-dir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: dirPath }) }).catch(() => {});
}

function openView(view: string, cwd: string | null): void {
  if (view === "prs") prsGotoIndex();
  else if (view === "wiki") wikiGotoIndex();
  else if (view === "collections") browseGotoIndex("collection");
  else if (view === "accounting") accountingViewOpen();
  else filesGotoIndex(cwd); // "files" and (until a dedicated route) "diff"
}

// "Reveal in the file manager" reveals `dirPath` in the OS file manager on a desktop. On a
// touch device that dialog would open on the SERVER's screen, unreachable, so fall back to the
// in-app file browser at the same dir — the mobile equivalent of a file manager.
function revealOrBrowse(dirPath: string): void {
  if (isTouchDevice()) filesGotoIndex(dirPath);
  else revealDir(dirPath);
}

function dispatchOpen(open: OpenTarget, cwd: string | null, slotKey: string | null): void {
  if (open.url) openUrl(open.url);
  else if (open.reveal) revealOrBrowse(open.reveal);
  else if (open.files) filesGotoIndex(open.files);
  else if (open.view) openView(open.view, cwd);
  else if (open.terminal) openTerminalAt(open.terminal, slotKey);
  else if (open.pickFile) pickFileInto(slotKey, cwd);
}

export function runHeaderButton(button: HeaderButton, slotKey: string | null, cwd: string | null): void {
  if (button.run === "input" && button.text && slotKey) {
    submitText(slotKey, button.text);
    return;
  }
  if (button.run === "open" && button.open) {
    dispatchOpen(button.open, cwd, slotKey);
    return;
  }
  // run === "shell" is dispatched by Terminal.vue (emits `run` → command cell); reaching here is a bug.
  console.warn(`[header] shell button "${button.id}" should be handled by Terminal.vue`);
}
