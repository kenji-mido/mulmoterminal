// The basename of a path a mocked `node:fs` was handed, on either separator.
//
// The registry builds its log paths with `path.join(MULMOTERMINAL_HOME, ...)`, so on Windows a
// double receives `C:\Users\...\unplaced-sessions.json`. Split on "/" that is one element — the
// whole path — so the name never equals the file the double is looking for: reads fall through to
// "" and recorded writes filter out to nothing. The spec then fails on Windows alone, which is how
// it reached main twice (#1212).
//
// `path.basename` is right at runtime and wrong here: on POSIX it leaves "\" alone, so the Windows
// case would be unassertable on the machines that run the suite.
//
// Compare on the exact name this returns, never `endsWith`: "unplaced-sessions.json" ends with
// "placed-sessions.json", so a suffix match reads the two logs as one.
export const mockedFileName = (file: unknown): string => String(file).split(/[/\\]/).pop() ?? "";
