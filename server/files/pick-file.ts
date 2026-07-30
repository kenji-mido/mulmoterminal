import type { Express, Request } from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import { isRecord } from "../../common/isRecord.js";
import { winFolderDialogScript } from "./win-folder-dialog.js";
import { PS_UTF8_STDOUT } from "./win-powershell-utf8.js";
import { requestOriginAllowed } from "../routes/same-origin-guard.js";

// A native "open file/folder" dialog per platform whose stdout is the selection's
// absolute path(s), newline-separated. Browsers can't hand the terminal a real
// filesystem path, but the local server can ask the OS. Fixed command + literal
// argv (the prompts are constants) — no shell, no input interpolation.
const FILE_PROMPT = "Select file(s)";
const DIR_PROMPT = "Select folder";

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
function winArgs(directory: boolean): string[] {
  if (directory) return ["-NoProfile", "-STA", "-Command", winFolderDialogScript(DIR_PROMPT)];
  const dialog = `$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect = $true; if ($d.ShowDialog() -eq 'OK') { $d.FileNames -join "\`n" }`;
  return ["-NoProfile", "-STA", "-Command", `${PS_UTF8_STDOUT}; Add-Type -AssemblyName System.Windows.Forms; ${dialog}`];
}

export function pickFileCommand(platform: NodeJS.Platform, directory = false): { cmd: string; args: string[] } {
  if (platform === "darwin") return { cmd: "osascript", args: macArgs(directory) };
  if (platform === "win32") return { cmd: "powershell", args: winArgs(directory) };
  const zenity = directory
    ? ["--file-selection", "--directory", `--title=${DIR_PROMPT}`]
    : ["--file-selection", "--multiple", "--separator=\n", `--title=${FILE_PROMPT}`];
  return { cmd: "zenity", args: zenity };
}

// `trim` is load-bearing beyond whitespace: U+FEFF is ECMAScript WhiteSpace, so it also drops a
// UTF-8 BOM a console host may print ahead of the first path — and BOM + `C:\proj` is not an
// absolute path, which would silently turn every pick into a cancel. A spec pins it.
export function parsePickerOutput(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && path.isAbsolute(line));
}

interface PickFileOptions {
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
}

// POST /api/pick-file — open the OS file dialog and return the chosen absolute
// path(s). Body `{ directory: true }` opens a FOLDER picker instead (for the launcher's
// Working-directory field). A user cancel yields empty stdout, so the response is
// { paths: [] }. Same-origin guarded like the other local-action routes.
export function mountPickFileRoute(app: Express, { isAllowedOrigin }: PickFileOptions) {
  app.post("/api/pick-file", (req: Request, res) => {
    if (!requestOriginAllowed(req, isAllowedOrigin)) return res.status(403).json({ error: "forbidden origin" });
    const directory = isRecord(req.body) && req.body.directory === true;
    const { cmd, args } = pickFileCommand(process.platform, directory);
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.on("error", (e) => {
      if (!res.headersSent) res.status(500).json({ error: `file dialog unavailable: ${e.message}` });
    });
    child.on("close", () => {
      if (!res.headersSent) res.json({ paths: parsePickerOutput(Buffer.concat(out).toString()) });
    });
  });
}
