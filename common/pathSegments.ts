// Splitting a filesystem path into its parts, on EITHER separator.
//
// `path.sep` is not the answer here: these paths come from a config file and from a saved
// directory list, so a Windows path can be read on a mac (a synced config, a bug report, a test
// fixture) and a POSIX one on Windows. Code that splits on "/" alone does not fail loudly on
// `C:\Users\me\project` — it returns the WHOLE STRING as one segment, which is how a "label"
// becomes an absolute path.
//
// That is a privacy contract in one place: the phone's project listing sends a label and never a
// path, precisely so a command or an artifact cannot publish the user's home directory. A
// one-separator split turns that guarantee off on Windows without changing a line of the code
// that states it.

/** The non-empty parts of a path, splitting on `/` and `\` alike. A drive letter (`C:`) stays a
 *  segment of its own — it is not a directory name, and nothing here wants it as one. */
export function pathSegments(value: string): string[] {
  return value.split(/[/\\]+/).filter((segment) => segment.length > 0);
}

/** The last part of a path — its directory or file name — or the input when it has none. */
export function lastSegment(value: string): string {
  return pathSegments(value).at(-1) ?? value;
}
