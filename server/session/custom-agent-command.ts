// Turning a custom agent's configured command line into an argv prefix for Claude Code.
//
// ARGV, not a shell. A launcher chip runs through `$SHELL -lc` because it IS the user's command
// and nothing else; here the command is a PREFIX that Claude Code's own argv is appended to, and
// that argv carries `--settings <inline JSON>` and `--append-system-prompt <paragraphs>`. Passing
// those back through a shell would mean quoting them correctly on every platform, and one missed
// quote is a session that starts with a mangled hook config rather than an error. Splitting the
// user's line once, here, is the half of the problem that is small enough to be right.
//
// The cost is that nothing in the command expands: no `$HOME`, no `~`, no pipes, no `&&`. That is
// stated in the config skill and in the guide, and it is why the field is a command line rather
// than a shell snippet. A user who wants a shell wants a launcher chip.

/** Split a command line into argv, honouring single and double quotes. Backslash escapes inside
 *  double quotes are honoured too (`"a\"b"`), so a Windows path in quotes survives; outside them
 *  a backslash is a literal, which is what makes `C:\src\repo` usable unquoted. */
export function tokenizeCommandLine(command: string): string[] {
  // One pass, one regex, four alternatives: a double-quoted run (with `\"` and `\\` unescaped
  // inside it), a single-quoted run (literal throughout, as a shell has it), a run of ordinary
  // characters, or whitespace — which ENDS the argument being built. Written as a scanner rather
  // than a character loop because the loop version needed a "did this argument start" flag to
  // tell `""` from a gap, and that flag is what made it hard to read.
  const scanner = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S)|(\s+)/y;
  const out: string[] = [];
  let current: string | null = null; // null = no argument in progress; "" is a real argument
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(command)) !== null) {
    const [, doubleQuoted, singleQuoted, bare, space] = match;
    if (space !== undefined) {
      if (current !== null) out.push(current);
      current = null;
      continue;
    }
    // A backslash is literal EXCEPT before a quote or another backslash inside double quotes, so
    // `"C:\Program Files\x"` keeps its separators while `"say \"hi\""` keeps its quotes.
    const piece = doubleQuoted !== undefined ? doubleQuoted.replace(/\\(["\\])/g, "$1") : (singleQuoted ?? bare ?? "");
    current = (current ?? "") + piece;
  }
  if (current !== null) out.push(current);
  return out;
}

/** What a custom agent's command line means to a spawn: the program to run, and the arguments
 *  that go BEFORE Claude Code's own. Null when the line has no program in it at all — an entry
 *  that survived config sanitizing but is, say, only quotes. */
export function customAgentLaunch(command: string): { file: string; prefixArgs: string[] } | null {
  const [file, ...prefixArgs] = tokenizeCommandLine(command);
  return file ? { file, prefixArgs } : null;
}
