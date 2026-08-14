// @vitest-environment node
import { describe, it, expect } from "vitest";
import express from "express";
import { appRequest } from "../../helpers/appRequest.js";
import {
  DIALOG_BUSY,
  mountPickFileRoute,
  pickFileCandidates,
  parsePickerOutput,
  pickedPaths,
  pickerRunFailed,
  pickerUnavailableMessage,
  type PickAnswer,
  type PickerHost,
  type PickerRun,
} from "../../../server/files/pick-file.js";
import { PS_UTF8_STDOUT } from "../../../server/files/win-powershell-utf8.js";

const NO_WSL = { wsl: false };
const WSL = { wsl: true };
const commands = (platform: NodeJS.Platform, directory = false, host: PickerHost = NO_WSL) => pickFileCandidates(platform, directory, host).map((c) => c.cmd);
const first = (platform: NodeJS.Platform, directory = false, host: PickerHost = NO_WSL) => pickFileCandidates(platform, directory, host)[0];
// The Windows scripts live in the last argv entry of either form (`-Command` / `-EncodedCommand`).
const winScript = (directory: boolean) => first("win32", directory).args[3];

describe("pickFileCandidates", () => {
  it("uses osascript on macOS", () => {
    expect(commands("darwin")).toEqual(["osascript"]);
  });
  it("uses powershell on Windows", () => {
    expect(commands("win32")).toEqual(["powershell"]);
  });
  // #1447: zenity ALONE was the whole Linux story, so a host without it got a button that did
  // nothing. Every one of these is a dialog somebody's desktop actually ships.
  it("tries the desktop dialogs in turn on Linux", () => {
    expect(commands("linux")).toEqual(["zenity", "kdialog", "qarma", "yad"]);
  });
  it("reaches the Windows dialog first on WSL, then the Linux ones", () => {
    expect(commands("linux", false, WSL)).toEqual([
      "powershell.exe",
      "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
      "zenity",
      "kdialog",
      "qarma",
      "yad",
    ]);
  });
  // Only the WSL candidates answer in Windows paths; mislabel a Linux one and every pick it makes
  // is thrown away by the absolute-path filter.
  it("marks only the WSL candidates as returning Windows paths", () => {
    const marked = pickFileCandidates("linux", true, WSL).filter((c) => c.windowsPaths);
    expect(marked.map((c) => c.cmd)).toEqual(["powershell.exe", "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"]);
    expect(pickFileCandidates("linux", true, NO_WSL).some((c) => c.windowsPaths)).toBe(false);
  });
  // WSL interop rebuilds our argv into one Windows command line, and the folder script is a
  // multi-line here-string full of quotes. Base64 UTF-16LE has nothing left to mangle.
  it("hands the WSL candidates the script base64-encoded, not as -Command", () => {
    const { args } = first("linux", true, WSL);
    expect(args).toContain("-EncodedCommand");
    expect(args).not.toContain("-Command");
    expect(Buffer.from(args[3], "base64").toString("utf16le")).toContain("FolderBrowserDialog");
  });
  it("keeps -Command on Windows itself", () => {
    expect(first("win32", true).args).toContain("-Command");
  });
});

describe("pickFileCandidates (directory mode)", () => {
  it("macOS: osascript 'choose folder'", () => {
    const { cmd, args } = first("darwin", true);
    expect(cmd).toBe("osascript");
    expect(args.join(" ")).toContain("choose folder");
  });
  // #1003: the folder picker asks the shell for its own dialog (the Explorer-style one), and
  // keeps the legacy tree only as the catch — so a runtime that cannot compile the interop still
  // lets the user choose a directory.
  it("Windows: the shell's IFileOpenDialog, with the legacy tree as the fallback", () => {
    const script = winScript(true);
    expect(script).toContain("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7"); // CLSID_FileOpenDialog
    expect(script).toContain("0x20"); // FOS_PICKFOLDERS — without it this picks files
    expect(script).toContain("FolderBrowserDialog"); // the fallback, inside `catch`
    expect(script).toMatch(/catch \{[\s\S]*FolderBrowserDialog/); // ...and only there
  });

  // COM dispatches by vtable slot, so the declaration order is behaviour: a missing or reordered
  // member calls a different function than the name says. Pinning the two that this depends on
  // catches a "tidy up the unused ones" edit.
  it("Windows: keeps the IFileDialog vtable order the interop depends on", () => {
    const script = winScript(true);
    const order = ["int Show(", "SetFileTypes(", "SetOptions(", "GetOptions(", "GetResult("];
    const positions = order.map((member) => script.indexOf(member));
    expect(positions.every((at) => at > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  // A PowerShell here-string ends only at a `'@` that starts its own line. Reflow the template and
  // the whole script becomes a syntax error — which nothing else here would notice.
  it("Windows: closes its here-string at the start of a line", () => {
    expect(winScript(true)).toContain("\n'@");
  });
  it("Linux: zenity --directory", () => {
    expect(first("linux", true).args).toContain("--directory");
  });
  it("file mode (default) is unchanged", () => {
    expect(first("darwin").args.join(" ")).toContain("choose file");
    expect(winScript(false)).toContain("OpenFileDialog");
    expect(first("linux").args).toContain("--multiple");
  });
});

// The start folder only exists so the WSL dialog opens inside the distro instead of on the
// Windows side. Windows itself passes none — the shell's own "last place you picked" beats it.
describe("the dialog's start folder", () => {
  const withStart = (platform: NodeJS.Platform, host: PickerHost) =>
    pickFileCandidates(platform, true, { ...host, startFolder: "\\\\wsl.localhost\\Ubuntu\\home\\o'brien" })[0];
  it("reaches the WSL folder dialog, single-quote-escaped", () => {
    const script = Buffer.from(withStart("linux", WSL).args[3], "base64").toString("utf16le");
    expect(script).toContain("'\\\\wsl.localhost\\Ubuntu\\home\\o''brien'");
  });
  it("is empty on Windows even when one is offered", () => {
    expect(withStart("win32", NO_WSL).args[3]).toContain("Pick('Select folder', '')");
  });
});

// #1146: PowerShell 5.1 pipes stdout in the OEM code page, so a path's non-ASCII part reaches Node
// mangled while `C:\` survives — an absolute-looking path that does not exist, which the launcher
// then quietly replaces with the default workspace. Both dialogs read stdout, so both need this.
describe("Windows picker output encoding", () => {
  it("forces UTF-8 stdout in the folder picker, before the dialog is shown", () => {
    const script = winScript(true);
    expect(script).toContain(PS_UTF8_STDOUT);
    expect(script.indexOf(PS_UTF8_STDOUT)).toBeLessThan(script.indexOf("Folder]::Pick"));
  });
  it("forces UTF-8 stdout in the file picker too", () => {
    const script = winScript(false);
    expect(script).toContain(PS_UTF8_STDOUT);
    expect(script.indexOf(PS_UTF8_STDOUT)).toBeLessThan(script.indexOf("OpenFileDialog"));
  });
  // `[System.Text.Encoding]::UTF8` carries a BOM preamble, which turns the first path into
  // "\uFEFFC:\..." — not absolute, so every pick would look like a cancel, on every locale.
  it("uses the BOM-less UTF8Encoding, not [System.Text.Encoding]::UTF8", () => {
    expect(PS_UTF8_STDOUT).toContain("UTF8Encoding $false");
    expect(PS_UTF8_STDOUT).not.toContain("[System.Text.Encoding]::UTF8");
  });
  // SetConsoleOutputCP can fail where no console is attached. Mangled output is the old behaviour;
  // a terminating error would cost the user the dialog itself.
  it("cannot kill the script when the console has no code page to set", () => {
    expect(PS_UTF8_STDOUT).toMatch(/^try \{.*\} catch \{ \}$/);
  });
});

// A cancel and a broken dialog look almost identical from here — both exit non-zero with no
// output. Read a cancel as a failure and the app shows an error every time somebody closes the
// dialog; read a failure as a cancel and you are back to the silent nothing of #1447.
describe("pickerRunFailed", () => {
  const run = (over: Partial<PickerRun> = {}): PickerRun => ({ code: 0, stdout: "", stderr: "", spawnError: null, ...over });

  it("fails when the command is not installed", () => {
    expect(pickerRunFailed(run({ code: null, spawnError: "spawn zenity ENOENT" }))).toBe(true);
  });
  it("fails when the dialog ran but explained itself on stderr", () => {
    expect(pickerRunFailed(run({ code: 1, stderr: "Unable to init server: Could not connect: Connection refused" }))).toBe(true);
  });
  it("is not a failure when zenity exits 1 saying nothing (the user cancelled)", () => {
    expect(pickerRunFailed(run({ code: 1 }))).toBe(false);
  });
  it("is not a failure when the Windows dialog exits 0 with no pick", () => {
    expect(pickerRunFailed(run({ code: 0 }))).toBe(false);
  });
  // osascript is the one that reports a CANCEL as an error, so its own pattern spares it.
  it("is not a failure when macOS reports the user's cancel", () => {
    const canceled = run({ code: 1, stderr: "osascript: execution error: User canceled. (-128)" });
    expect(pickerRunFailed(canceled, /\(-128\)/)).toBe(false);
    expect(pickerRunFailed(canceled)).toBe(true); // ...and it IS a failure without the pattern
  });
  // The SENTENCE is localized — this is verbatim from `osascript -e 'error number -128'` on a
  // Japanese macOS. Matching the code rather than the English wording is what makes the cancel
  // readable on every locale, so both are pinned here.
  it("reads a cancel reported in the user's own language", () => {
    const [pattern] = pickFileCandidates("darwin", true).map((c) => c.cancelStderr);
    const localized = run({ code: 1, stderr: "0:17: execution error: ユーザによってキャンセルされました。 (-128)" });
    expect(pickerRunFailed(localized, pattern)).toBe(false);
  });
  it("is not a failure when a path came back, whatever the exit code", () => {
    expect(pickerRunFailed(run({ code: 1, stdout: "/a/b", stderr: "warning: ignoring config" }))).toBe(false);
  });
});

describe("pickerUnavailableMessage", () => {
  it("tells a Linux user what to install", () => {
    expect(pickerUnavailableMessage("linux", false, ["zenity: spawn zenity ENOENT"])).toContain("sudo apt install zenity");
  });
  it("tells a WSL user that interop failed too", () => {
    expect(pickerUnavailableMessage("linux", true, [])).toContain("interop");
  });
  it("carries what each candidate said, so the reason is not lost", () => {
    expect(pickerUnavailableMessage("linux", false, ["zenity: no display", "yad: ENOENT"])).toContain("[zenity: no display; yad: ENOENT]");
  });
  it("says nothing about installing a dialog on macOS", () => {
    expect(pickerUnavailableMessage("darwin", false, ["osascript: boom"])).not.toContain("zenity");
  });
});

describe("parsePickerOutput", () => {
  it("splits newline-separated absolute paths", () => {
    expect(parsePickerOutput("/a/b.txt\n/c/d.txt")).toEqual(["/a/b.txt", "/c/d.txt"]);
  });
  it("trims and drops blank lines", () => {
    expect(parsePickerOutput("  /a.txt  \n\n")).toEqual(["/a.txt"]);
  });
  it("handles CRLF output", () => {
    expect(parsePickerOutput("/a.txt\r\n/b.txt\r\n")).toEqual(["/a.txt", "/b.txt"]);
  });
  it("rejects relative or junk lines (e.g. a cancel message)", () => {
    expect(parsePickerOutput("not a path\nrelative/p.txt")).toEqual([]);
  });
  it("returns empty for empty output (user canceled)", () => {
    expect(parsePickerOutput("")).toEqual([]);
  });
  // Not CJK-specific: the bug is a code page, so every non-ASCII script travels the same path.
  it("keeps non-ASCII paths byte-for-byte, in any script", () => {
    const paths = ["/proj/日本語フォルダ", "/proj/中文目录", "/proj/한국어폴더", "/proj/café", "/proj/Кириллица", "/proj/📁"];
    expect(parsePickerOutput(paths.join("\n"))).toEqual(paths);
  });
  // A console host may print a UTF-8 BOM ahead of the first line; `trim` drops it because U+FEFF is
  // ECMAScript WhiteSpace. Pinned so a "tidier" line filter cannot turn a pick into a cancel.
  it("tolerates a UTF-8 BOM ahead of the first path", () => {
    expect(parsePickerOutput("\uFEFF/proj/日本語\n/proj/b")).toEqual(["/proj/日本語", "/proj/b"]);
  });
  // The WSL dialog answers `C:\proj`, which is NOT absolute to posix — so its output has to be
  // translated BEFORE this filter, never after. Pinned because getting the order wrong turns
  // every WSL pick into a silent cancel, which is indistinguishable from the bug being fixed.
  // Skipped on Windows, where `path.isAbsolute` reads that path the other way and WSL cannot run.
  it.skipIf(process.platform === "win32")("drops a Windows path, which is why the WSL conversion happens first", () => {
    expect(parsePickerOutput("C:\\proj\\a")).toEqual([]);
  });
});

// A WSL pick has to survive the trip back through `wslpath`. If it doesn't, the route must NOT
// answer with an empty list — that is what a cancel looks like, and the silence it produces is
// exactly the bug #1447 reported. Observed during review, not flagged by a bot.
describe("pickedPaths", () => {
  const wslCandidate = { cmd: "powershell.exe", args: [], windowsPaths: true };

  it("translates the Windows paths a WSL dialog returns", async () => {
    const convert = (p: string) => Promise.resolve(p.replace("C:\\", "/mnt/c/").replaceAll("\\", "/"));
    await expect(pickedPaths("C:\\proj\\a\nC:\\proj\\b", wslCandidate, convert)).resolves.toEqual({
      paths: ["/mnt/c/proj/a", "/mnt/c/proj/b"],
      untranslated: 0,
    });
  });

  it("counts what it could not translate, so the route can tell that from a cancel", async () => {
    const convert = () => Promise.resolve(null);
    await expect(pickedPaths("C:\\proj\\a", wslCandidate, convert)).resolves.toEqual({ paths: [], untranslated: 1 });
  });

  it("reports a real cancel as nothing to translate", async () => {
    await expect(pickedPaths("", wslCandidate, () => Promise.resolve(null))).resolves.toEqual({ paths: [], untranslated: 0 });
  });

  it("leaves a Linux dialog's output alone", async () => {
    await expect(pickedPaths("/a/b\n/c/d", { cmd: "zenity", args: [] })).resolves.toEqual({ paths: ["/a/b", "/c/d"], untranslated: 0 });
  });
});

// #1527: the client's own guard covers the clicks IT can see. Another tab, or this tab after a
// reload, is a fresh document that knows nothing about the dialog already on screen — the route
// is the only place that knows the machine has just one.
describe("the pick-file route while a dialog is open", () => {
  /** A dialog run that stays unanswered until the test says the user closed it. */
  function heldDialog() {
    let close: (answer: PickAnswer) => void = () => {};
    const answer = new Promise<PickAnswer>((resolve) => (close = resolve));
    return { answer, close };
  }

  function mount(openDialog: (directory: boolean) => Promise<PickAnswer>) {
    const app = express();
    app.use(express.json());
    mountPickFileRoute(app, { isAllowedOrigin: () => true, openDialog });
    const request = appRequest(app);
    return () => request("/api/pick-file", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ directory: true }) });
  }

  it("answers 409 rather than opening a second dialog", async () => {
    const dialog = heldDialog();
    const post = mount(() => dialog.answer);
    const first = post();
    const second = await post();
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: DIALOG_BUSY });
    dialog.close({ status: 200, body: { paths: ["/a"] } });
    expect((await first).status).toBe(200);
  });

  it("takes a request again once the dialog closed", async () => {
    const dialog = heldDialog();
    const post = mount(() => dialog.answer);
    const first = post();
    dialog.close({ status: 200, body: { paths: ["/a"] } });
    await first;
    const second = await post();
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ paths: ["/a"] });
  });

  // A lock a failure leaves latched is worse than the bug: every later pick would 409 forever.
  it("releases the lock when the dialog run throws", async () => {
    let fail = true;
    const post = mount(() => (fail ? Promise.reject(new Error("spawn ENOENT")) : Promise.resolve({ status: 200, body: { paths: ["/a"] } })));
    await post();
    fail = false;
    expect((await post()).status).toBe(200);
  });
});
