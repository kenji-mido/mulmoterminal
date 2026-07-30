// Make a spawned PowerShell print UTF-8, for every script here whose stdout we read back.
//
// Windows PowerShell 5.1 writes a piped stdout in the console's OEM code page — CP932 on Japanese
// Windows, CP936 / CP949 / CP1251 elsewhere — so a chosen path arrives with its non-ASCII part
// mangled while the ASCII `C:\` prefix survives. The corrupted path then passes `path.isAbsolute`,
// fails `statSync`, and the launcher starts in the default workspace instead of the folder the user
// picked (#1146). Nothing about this is CJK-specific; `café` breaks the same way.
//
// `UTF8Encoding $false`, never `[System.Text.Encoding]::UTF8`: that one carries a BOM preamble,
// which some console hosts emit ahead of the first line. `parsePickerOutput` tolerates it, but only
// just — a picker that returns nothing at all on every locale would be a worse bug than the one
// being fixed, so don't stake the fix on that.
//
// The `catch` is empty and deliberate: the setter calls SetConsoleOutputCP, which can fail where no
// console is attached. Losing UTF-8 there costs a mangled path — the behaviour before this existed.
// Letting the exception out would kill the script, and the button would do nothing.
export const PS_UTF8_STDOUT = "try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }";
