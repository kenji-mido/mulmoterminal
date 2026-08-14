// Dispatch a header action button. `input` types text into the running session; `open` opens a
// url / reveals a dir / opens the in-app file explorer or a view. `shell` is handled upstream in
// Terminal.vue (it emits `run` to open a command cell), so it never reaches here — the branch below
// is only a defensive no-op warn.
import { filesGotoIndex } from "./useFilesView";
import { githubGotoIndex } from "./useGithubView";
import { wikiGotoIndex } from "./useWikiBrowse";
import { browseGotoIndex } from "./useCollectionBrowse";
import { accountingViewOpen } from "./useAccountingView";
import { submitText, insertText } from "./useTerminalConnections";
import { openTerminalAt } from "./useNewTerminal";
import { toInsertText } from "../components/dropPaths";
import { openFilePicker } from "./useFilePicker";
import { isTouchDevice } from "./touchDevice";
import type { HeaderButton, OpenTarget } from "./useHeaderButtons";
// No pickPaths: the native /api/pick-file route is not the picker this fork uses (see
// pickFileInto below).
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

const OPEN_URL_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

/** Where a failed action explains itself — the cell's own banner, supplied by Terminal.vue. */
export type ReportProblem = (message: string) => void;

// Pick a file and insert its path at the session's cursor. The fork's IN-BROWSER picker, not
// upstream's /api/pick-file: that route opens the native dialog on the SERVER's display, which is
// unreachable from a phone or any other tab on the tailnet — and "remote" cannot be told from
// "local" client-side (an SSH forward makes a phone look like localhost). It therefore takes no
// ReportProblem the way its neighbours do: there is no host-side dialog to be missing, and the
// picker is its own UI. `cwd` seeds where it opens (the session's working dir).
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

// Reveal a directory in the OS file manager. The route answers only once the opener has actually
// started, so a host that has none (a bare Linux box with no `xdg-open`) reports it rather than
// leaving the button looking broken (#1447).
async function revealDir(dirPath: string, report: ReportProblem): Promise<void> {
  try {
    const res = await fetchWithTimeout("/api/open-dir", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: dirPath }),
    });
    if (!res.ok) report(revealFailureText(await jsonBody(res), res.status));
  } catch (e) {
    report(`Could not open the folder: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const revealFailureText = (body: Record<string, unknown>, status: number): string =>
  typeof body.error === "string" && body.error.length > 0 ? body.error : `Could not open the folder (HTTP ${status}).`;

function openView(view: string, cwd: string | null): void {
  // `"prs"` is the value users have written in their own header configs (documented in both
  // guides and the -header skill), so it stays what it is. Only the view it opens was renamed.
  if (view === "prs") githubGotoIndex();
  else if (view === "wiki") wikiGotoIndex();
  else if (view === "collections") browseGotoIndex("collection");
  else if (view === "accounting") accountingViewOpen();
  else filesGotoIndex(cwd); // "files" and (until a dedicated route) "diff"
}

// "Reveal in the file manager" reveals `dirPath` in the OS file manager on a desktop. On a
// touch device that dialog would open on the SERVER's screen, unreachable, so fall back to the
// in-app file browser at the same dir — the mobile equivalent of a file manager.
function revealOrBrowse(dirPath: string, report: ReportProblem): void {
  if (isTouchDevice()) filesGotoIndex(dirPath);
  else void revealDir(dirPath, report);
}

function dispatchOpen(open: OpenTarget, cwd: string | null, slotKey: string | null, report: ReportProblem): void {
  if (open.url) openUrl(open.url);
  else if (open.reveal) revealOrBrowse(open.reveal, report);
  else if (open.files) filesGotoIndex(open.files);
  else if (open.view) openView(open.view, cwd);
  else if (open.terminal) openTerminalAt(open.terminal, slotKey);
  else if (open.pickFile) pickFileInto(slotKey, cwd);
}

const logProblem: ReportProblem = (message) => console.warn(`[header] ${message}`);

export function runHeaderButton(button: HeaderButton, slotKey: string | null, cwd: string | null, report: ReportProblem = logProblem): void {
  if (button.run === "input" && button.text && slotKey) {
    submitText(slotKey, button.text);
    return;
  }
  if (button.run === "open" && button.open) {
    dispatchOpen(button.open, cwd, slotKey, report);
    return;
  }
  // run === "shell" is dispatched by Terminal.vue (emits `run` → command cell); reaching here is a bug.
  console.warn(`[header] shell button "${button.id}" should be handled by Terminal.vue`);
}
