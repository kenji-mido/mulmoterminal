import { describe, it, expect } from "vitest";
import { pickFileCommand, parsePickerOutput } from "../../../server/files/pick-file.js";
import { PS_UTF8_STDOUT } from "../../../server/files/win-powershell-utf8.js";

describe("pickFileCommand", () => {
  it("uses osascript on macOS", () => {
    expect(pickFileCommand("darwin").cmd).toBe("osascript");
  });
  it("uses powershell on Windows", () => {
    expect(pickFileCommand("win32").cmd).toBe("powershell");
  });
  it("falls back to zenity elsewhere (Linux)", () => {
    expect(pickFileCommand("linux").cmd).toBe("zenity");
  });
});

describe("pickFileCommand (directory mode)", () => {
  it("macOS: osascript 'choose folder'", () => {
    const { cmd, args } = pickFileCommand("darwin", true);
    expect(cmd).toBe("osascript");
    expect(args.join(" ")).toContain("choose folder");
  });
  // #1003: the folder picker asks the shell for its own dialog (the Explorer-style one), and
  // keeps the legacy tree only as the catch — so a runtime that cannot compile the interop still
  // lets the user choose a directory.
  it("Windows: the shell's IFileOpenDialog, with the legacy tree as the fallback", () => {
    const script = pickFileCommand("win32", true).args.join(" ");
    expect(script).toContain("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7"); // CLSID_FileOpenDialog
    expect(script).toContain("0x20"); // FOS_PICKFOLDERS — without it this picks files
    expect(script).toContain("FolderBrowserDialog"); // the fallback, inside `catch`
    expect(script).toMatch(/catch \{[\s\S]*FolderBrowserDialog/); // ...and only there
  });

  // COM dispatches by vtable slot, so the declaration order is behaviour: a missing or reordered
  // member calls a different function than the name says. Pinning the two that this depends on
  // catches a "tidy up the unused ones" edit.
  it("Windows: keeps the IFileDialog vtable order the interop depends on", () => {
    const script = pickFileCommand("win32", true).args.join(" ");
    const order = ["int Show(", "SetFileTypes(", "SetOptions(", "GetOptions(", "GetResult("];
    const positions = order.map((member) => script.indexOf(member));
    expect(positions.every((at) => at > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  // A PowerShell here-string ends only at a `'@` that starts its own line. Reflow the template and
  // the whole script becomes a syntax error — which nothing else here would notice.
  it("Windows: closes its here-string at the start of a line", () => {
    expect(pickFileCommand("win32", true).args[3]).toContain("\n'@");
  });
  it("Linux: zenity --directory", () => {
    expect(pickFileCommand("linux", true).args).toContain("--directory");
  });
  it("file mode (default) is unchanged", () => {
    expect(pickFileCommand("darwin").args.join(" ")).toContain("choose file");
    expect(pickFileCommand("win32").args.join(" ")).toContain("OpenFileDialog");
    expect(pickFileCommand("linux").args).toContain("--multiple");
  });
});

// #1146: PowerShell 5.1 pipes stdout in the OEM code page, so a path's non-ASCII part reaches Node
// mangled while `C:\` survives — an absolute-looking path that does not exist, which the launcher
// then quietly replaces with the default workspace. Both dialogs read stdout, so both need this.
describe("Windows picker output encoding", () => {
  it("forces UTF-8 stdout in the folder picker, before the dialog is shown", () => {
    const script = pickFileCommand("win32", true).args[3];
    expect(script).toContain(PS_UTF8_STDOUT);
    expect(script.indexOf(PS_UTF8_STDOUT)).toBeLessThan(script.indexOf("Folder]::Pick"));
  });
  it("forces UTF-8 stdout in the file picker too", () => {
    const script = pickFileCommand("win32", false).args[3];
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
});
