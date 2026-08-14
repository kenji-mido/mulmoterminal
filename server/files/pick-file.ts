import type { Express, Request } from "express";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { isRecord } from "../../common/isRecord.js";
import { winFolderDialogScript } from "./win-folder-dialog.js";
import { PS_UTF8_STDOUT } from "./win-powershell-utf8.js";
import { psSingleQuoted } from "./ps-quote.js";
import { isWsl, toLinuxPath, toWindowsPath } from "./wsl.js";
import { requestOriginAllowed } from "../routes/same-origin-guard.js";

// A native "open file/folder" dialog per platform whose stdout is the selection's
// absolute path(s), newline-separated. Browsers can't hand the terminal a real
// filesystem path, but the local server can ask the OS. Fixed commands + literal
// argv — the prompts are constants, and the one runtime value (the start folder,
// derived from this process's own home directory) goes through `psSingleQuoted`.
//
// There is no single dialog on Linux, so a platform yields a LIST of candidates and the route
// takes the first that runs: WSL reaches the Windows one over interop, a desktop has whichever
// toolkit it was installed with. Before #1447 this was `zenity` alone, and a host without it got
// a button that did nothing at all.
const FILE_PROMPT = "Select file(s)";
const DIR_PROMPT = "Select folder";

export interface PickerCandidate {
  cmd: string;
  args: string[];
  /** stdout carries WINDOWS paths — the Windows dialog, reached from WSL over interop. */
  windowsPaths?: boolean;
  /** stderr this tool prints when the USER cancels, which must not read as a broken dialog. */
  cancelStderr?: RegExp;
}

// macOS says "User canceled. (-128)" on stderr and exits non-zero for a cancel — the one dialog
// here that reports a cancel as an error. Read as a failure it would put an error on screen every
// time someone closes the dialog, which is worse than the bug this file is fixing.
const MAC_USER_CANCELED = /\(-128\)/;

// macOS: `choose file` (multi) vs `choose folder` (single — a working directory is one dir).
function macArgs(directory: boolean): string[] {
  if (directory) return ["-e", `return POSIX path of (choose folder with prompt "${DIR_PROMPT}")`];
  return [
    "-e",
    `set chosen to choose file with prompt "${FILE_PROMPT}" with multiple selections allowed`,
    "-e",
    "set text item delimiters to linefeed",
    "-e",
    "set out to {}",
    "-e",
    "repeat with f in chosen",
    "-e",
    "set end of out to POSIX path of f",
    "-e",
    "end repeat",
    "-e",
    "return out as text",
  ];
}

// The FILE dialog needs nothing special: `OpenFileDialog` has been the Explorer-style one since
// Vista. Only the FOLDER dialog is stuck on the legacy tree, so only it goes through COM (#1003).
function winPickerScript(directory: boolean, startFolder: string | null): string {
  if (directory) return winFolderDialogScript(DIR_PROMPT, startFolder);
  const start = startFolder ? `$d.InitialDirectory = ${psSingleQuoted(startFolder)}; ` : "";
  const dialog = `$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect = $true; ${start}if ($d.ShowDialog() -eq 'OK') { $d.FileNames -join "\`n" }`;
  return `${PS_UTF8_STDOUT}; Add-Type -AssemblyName System.Windows.Forms; ${dialog}`;
}

// Where WSL looks for the Windows shell. `powershell.exe` alone covers a default install (WSL
// appends the Windows PATH); the absolute path is for `appendWindowsPath = false` in wsl.conf,
// where nothing Windows-side is on PATH at all.
const WSL_POWERSHELL = ["powershell.exe", "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"];

// `-EncodedCommand` (base64 UTF-16LE), not `-Command`, for the WSL candidates only: interop
// rebuilds our argv into a single Windows command line, and the folder script is a multi-line
// here-string full of quotes. Windows itself keeps `-Command`, which is what ships and works.
const encodedCommandArgs = (script: string): string[] => ["-NoProfile", "-STA", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];

// zenity's own options, which qarma (its Qt rebuild) takes verbatim.
const zenityArgs = (directory: boolean): string[] =>
  directory ? ["--file-selection", "--directory", `--title=${DIR_PROMPT}`] : ["--file-selection", "--multiple", "--separator=\n", `--title=${FILE_PROMPT}`];

const kdialogArgs = (directory: boolean): string[] =>
  directory ? ["--title", DIR_PROMPT, "--getexistingdirectory", "."] : ["--title", FILE_PROMPT, "--getopenfilename", ".", "--multiple", "--separate-output"];

// yad forked from zenity before `--file-selection` and spells it `--file`.
const yadArgs = (directory: boolean): string[] =>
  directory ? ["--file", "--directory", `--title=${DIR_PROMPT}`] : ["--file", "--multiple", "--separator=\n", `--title=${FILE_PROMPT}`];

/** The Linux desktop dialogs, in the order they are tried: GNOME, KDE, then the two clones. */
function linuxPickerCandidates(directory: boolean): PickerCandidate[] {
  return [
    { cmd: "zenity", args: zenityArgs(directory) },
    { cmd: "kdialog", args: kdialogArgs(directory) },
    { cmd: "qarma", args: zenityArgs(directory) },
    { cmd: "yad", args: yadArgs(directory) },
  ];
}

/** What the host is, decided ONCE by the route. `startFolder` is a WINDOWS path, and WSL-only. */
export interface PickerHost {
  wsl?: boolean;
  startFolder?: string | null;
}

/** Every dialog worth trying on this host, best first. */
export function pickFileCandidates(platform: NodeJS.Platform, directory: boolean, host: PickerHost = {}): PickerCandidate[] {
  if (platform === "darwin") return [{ cmd: "osascript", args: macArgs(directory), cancelStderr: MAC_USER_CANCELED }];
  if (platform === "win32") return [{ cmd: "powershell", args: ["-NoProfile", "-STA", "-Command", winPickerScript(directory, null)] }];
  const linux = linuxPickerCandidates(directory);
  if (!host.wsl) return linux;
  const args = encodedCommandArgs(winPickerScript(directory, host.startFolder ?? null));
  // The Windows dialog first: it needs nothing installed. A WSL user who DID install zenity still
  // gets it, one candidate later, if interop is off — which is also what makes a WRONG guess at
  // "this is WSL" cost an ENOENT rather than the feature.
  return [...WSL_POWERSHELL.map((cmd) => ({ cmd, args, windowsPaths: true })), ...linux];
}

export interface PickerRun {
  /** null when the command could not be started at all. */
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError: string | null;
}

// Did this candidate fail to give the user a dialog — as opposed to giving them one they closed?
// The two look alike from here: a cancel is a non-zero exit with no output, and so is a zenity
// that could not reach a display. What separates them is that the broken one explains itself on
// stderr. Guessing wrong in either direction is a real bug — an error toast on every cancel, or
// the silent nothing from #1447 — so the rule is pinned by specs rather than inlined.
export function pickerRunFailed(run: PickerRun, cancelStderr?: RegExp): boolean {
  if (run.spawnError !== null) return true;
  if (run.code === 0 || run.stdout.trim().length > 0) return false;
  const stderr = run.stderr.trim();
  if (stderr.length === 0) return false;
  return !(cancelStderr?.test(stderr) ?? false);
}

const INSTALL_A_DIALOG = "install zenity (sudo apt install zenity · sudo dnf install zenity), kdialog, qarma or yad";

/** What the user is told when no candidate could open a dialog — it has to name the way out. */
export function pickerUnavailableMessage(platform: NodeJS.Platform, wsl: boolean, attempts: string[]): string {
  const detail = attempts.length > 0 ? ` [${attempts.join("; ")}]` : "";
  if (wsl)
    return `No file dialog on this host: WSL could not run the Windows one over interop, and no Linux dialog is installed — ${INSTALL_A_DIALOG}.${detail}`;
  if (platform === "darwin" || platform === "win32") return `File dialog unavailable.${detail}`;
  return `No file dialog on this host — ${INSTALL_A_DIALOG}.${detail}`;
}

/** stdout's non-empty lines. `trim` is load-bearing beyond whitespace: U+FEFF is ECMAScript
 *  WhiteSpace, so it also drops a UTF-8 BOM a console host may print ahead of the first path. */
export const pickerLines = (stdout: string): string[] =>
  stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

// BOM + `C:\proj` is not an absolute path, which would silently turn every pick into a cancel.
// A spec pins it.
export function parsePickerOutput(stdout: string): string[] {
  return pickerLines(stdout).filter((line) => path.isAbsolute(line));
}

export interface PickOutcome {
  paths: string[];
  /** Lines the dialog returned that could not be turned into a path this process can open. */
  untranslated: number;
}

// The WSL dialog answers in Windows paths, and `C:\proj` is NOT absolute to posix — so the
// translation has to happen BEFORE the filter above, or every pick reads as a cancel.
//
// `untranslated` exists because that failure mode IS the bug in #1447: a `wslpath` that is missing
// or refuses a UNC path would otherwise turn a real pick into `paths: []`, which the UI cannot
// tell from a cancel, so the button silently does nothing all over again.
export async function pickedPaths(stdout: string, candidate: PickerCandidate, convert = toLinuxPath): Promise<PickOutcome> {
  if (!candidate.windowsPaths) return { paths: parsePickerOutput(stdout), untranslated: 0 };
  const lines = pickerLines(stdout);
  const converted = await Promise.all(lines.map((line) => convert(line)));
  const paths = converted.filter((p): p is string => p !== null && path.isAbsolute(p));
  return { paths, untranslated: lines.length - paths.length };
}

function runPicker(candidate: PickerCandidate): Promise<PickerRun> {
  return new Promise((resolve) => {
    const child = spawn(candidate.cmd, candidate.args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (e) => resolve({ code: null, stdout: "", stderr: "", spawnError: e.message }));
    child.on("close", (code) => resolve({ code, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString(), spawnError: null }));
  });
}

/** One line per candidate that failed, for the message the user reads. */
function attemptNote(candidate: PickerCandidate, run: PickerRun): string {
  const said = run.spawnError ?? pickerLines(run.stderr)[0] ?? `exit ${run.code}`;
  return `${candidate.cmd}: ${said}`;
}

// Where the WSL dialog opens: this user's home INSIDE the distro. Without it the Windows dialog
// starts on the Windows side, and reaching a project means typing a `\\wsl.localhost\…` UNC path.
const wslStartFolder = (wsl: boolean): Promise<string | null> => (wsl ? toWindowsPath(os.homedir()) : Promise.resolve(null));

/** What the route answers: the chosen paths, or why no dialog could be opened. */
export interface PickAnswer {
  status: number;
  body: { paths: string[] } | { error: string };
}

// Every dialog this host has, tried in turn until one runs.
async function runPickerDialogs(directory: boolean): Promise<PickAnswer> {
  // Asked ONCE, here at the edge: everything below takes the answer rather than re-deriving it
  // from the environment, so there is a single place that decides what this host is.
  const wsl = isWsl(process.platform, process.env);
  const startFolder = await wslStartFolder(wsl);
  const attempts: string[] = [];
  for (const candidate of pickFileCandidates(process.platform, directory, { wsl, startFolder })) {
    const run = await runPicker(candidate);
    if (pickerRunFailed(run, candidate.cancelStderr)) {
      attempts.push(attemptNote(candidate, run));
      continue;
    }
    const { paths, untranslated } = await pickedPaths(run.stdout, candidate);
    // Nothing usable out of something the user DID pick: keep going, and say so, rather than
    // answering with the empty list that means "cancelled".
    if (paths.length === 0 && untranslated > 0) {
      attempts.push(`${candidate.cmd}: wslpath could not translate ${untranslated} chosen path(s)`);
      continue;
    }
    return { status: 200, body: { paths } };
  }
  return { status: 500, body: { error: pickerUnavailableMessage(process.platform, wsl, attempts) } };
}

// The dialog belongs to the MACHINE, not to a page. A second browser tab — or the same tab after
// a reload — knows nothing about the one already on screen, so the client's own guard cannot be
// the only one: without this, those paths still stack dialogs the user has to close one by one
// (#1527). 409 rather than an empty list, because the client says WHY nothing opened.
let dialogOpen = false;
export const DIALOG_BUSY = "A file dialog is already open — finish or cancel it first.";

interface PickFileOptions {
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
  /** The dialog run, injectable so a spec can pin this route without opening a real dialog. */
  openDialog?: (directory: boolean) => Promise<PickAnswer>;
}

// POST /api/pick-file — open the OS file dialog and return the chosen absolute
// path(s). Body `{ directory: true }` opens a FOLDER picker instead (for the launcher's
// Working-directory field). A user cancel yields empty stdout, so the response is
// { paths: [] }; a host with no dialog at all is a 500 whose message names the fix, and the
// UI shows it. Same-origin guarded like the other local-action routes.
export function mountPickFileRoute(app: Express, { isAllowedOrigin, openDialog = runPickerDialogs }: PickFileOptions) {
  app.post("/api/pick-file", async (req: Request, res) => {
    if (!requestOriginAllowed(req, isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    if (dialogOpen) return res.status(409).json({ error: DIALOG_BUSY });
    dialogOpen = true;
    try {
      const { status, body } = await openDialog(isRecord(req.body) && req.body.directory === true);
      res.status(status).json(body);
    } finally {
      dialogOpen = false;
    }
  });
}
