import { PS_UTF8_STDOUT } from "./win-powershell-utf8.js";

// The Windows folder picker, in the dialog Explorer actually uses (#1003).
//
// `System.Windows.Forms.FolderBrowserDialog` — what this used to open, and what the fallback at
// the bottom still opens — is the legacy tree: no address bar, no path box, no favourites, so
// reaching a project means clicking down the hierarchy. On .NET Framework (which the stock
// `powershell` 5.1 runs on) it has no modern mode; the shell's own `IFileOpenDialog` with
// FOS_PICKFOLDERS is the only way to get the Explorer-style one without requiring PowerShell 7.
//
// Hence the COM interop below. Two things about it are load-bearing:
//
//  1. **The member order IS the vtable.** COM dispatches by slot, not by name, so moving or
//     dropping a single method silently calls the wrong function. Every method of IFileDialog and
//     IShellItem is declared, in MSDN's order, even the ones unused here — that is why they are
//     listed rather than trimmed.
//  2. **Failure must land somewhere safe.** This runs on a machine the author cannot test on, so
//     the script wraps the interop in try/catch and falls back to the old dialog. A wrong flag, a
//     locked-down runtime, or an `Add-Type` that cannot compile then costs the user the nicer
//     dialog — not the ability to choose a folder.

// FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST: a real directory on a real
// filesystem, so the caller always gets a path it can hand to a shell.
const FOS_FLAGS = "0x20 | 0x40 | 0x800";
const CLSID_FILE_OPEN_DIALOG = "DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7";
const IID_IFILE_DIALOG = "42f85136-db7e-439c-85f1-e4075d135fc8";
const IID_ISHELL_ITEM = "43826d1e-e718-42ee-bc55-a1e261c37bfe";
// SIGDN_FILESYSPATH — the display name as a filesystem path rather than a pretty name.
const SIGDN_FILESYSPATH = "0x80058000";

// The COM declarations, kept out of the script template so the PowerShell around them stays
// readable — and so the arrow function below is a few lines rather than eighty.
const FOLDER_PICKER_CSHARP = `using System;
using System.Runtime.InteropServices;
namespace MtPicker {
  [ComImport, Guid("${IID_ISHELL_ITEM}"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, out IntPtr ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare(IShellItem psi, uint hint, out int piOrder);
  }
  [ComImport, Guid("${IID_IFILE_DIALOG}"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
    void SetFileTypeIndex(uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise(IntPtr pfde, out uint pdwCookie);
    void Unadvise(uint dwCookie);
    void SetOptions(uint fos);
    void GetOptions(out uint fos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName(out IntPtr pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
    void AddPlace(IShellItem psi, int fdap);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
    void Close(int hr);
    void SetClientGuid(ref Guid guid);
    void ClearClientData();
    void SetFilter(IntPtr pFilter);
  }
  public static class Folder {
    public static string Pick(string title) {
      Type type = Type.GetTypeFromCLSID(new Guid("${CLSID_FILE_OPEN_DIALOG}"));
      IFileDialog dialog = (IFileDialog)Activator.CreateInstance(type);
      try {
        uint options;
        dialog.GetOptions(out options);
        dialog.SetOptions(options | ${FOS_FLAGS});
        dialog.SetTitle(title);
        if (dialog.Show(IntPtr.Zero) != 0) return null;
        IShellItem item;
        dialog.GetResult(out item);
        IntPtr buffer;
        item.GetDisplayName(${SIGDN_FILESYSPATH}, out buffer);
        try { return Marshal.PtrToStringUni(buffer); }
        finally { Marshal.FreeCoTaskMem(buffer); }
      } finally {
        Marshal.ReleaseComObject(dialog);
      }
    }
  }
}`;

// NOTE: the `'@` terminator of a PowerShell here-string must start its own line, or the script is
// a syntax error. A spec pins that, because prettier reflowing this template would not fail
// anything else.
export const winFolderDialogScript = (prompt: string): string => `
${PS_UTF8_STDOUT}
$ErrorActionPreference = 'Stop'
function Get-MtModernFolder {
  Add-Type -TypeDefinition @'
${FOLDER_PICKER_CSHARP}
'@
  return [MtPicker.Folder]::Pick('${prompt}')
}
try {
  $picked = Get-MtModernFolder
  if ($picked) { $picked }
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  $legacy = New-Object System.Windows.Forms.FolderBrowserDialog
  $legacy.Description = '${prompt}'
  if ($legacy.ShowDialog() -eq 'OK') { $legacy.SelectedPath }
}
`;
