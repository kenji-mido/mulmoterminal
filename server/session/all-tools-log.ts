// Which sessions carry the WHOLE GUI MCP, as it is read from and written back to disk.
//
// A plain id log (session-id-log.ts) would do, except for one thing its own header rules out:
// "an id is the only thing ever added (nothing removes one)". This fact can go away. A session id
// is reused across spawns, and the next process gets whatever it is given at THAT moment — a
// session that was the single view yesterday can be a project-directory grid cell today, with no
// all-tools url at all.
//
// That was survivable while the answer only widened a pane's tool list. It is not now: a group url
// serves nothing to a session that carries every tool (mcp/tool-gate.ts), so a stale yes would
// leave a cell with its groups stood down and nothing to stand in for them — no GUI tools at all.
//
// So it takes the shape session-tool-groups.ts already uses for the same reason: an APPEND log with
// a RELEASE marker, replayed in order. Appending needs no read, which is what keeps it safe without
// a lock while MULMOTERMINAL_HOME is shared between server instances. A bare id still reads as a
// claim, so a file written before the marker existed keeps working.

/** A session's RELEASE marker: the id no longer carries the whole GUI MCP. */
export const ALL_TOOLS_RELEASE = "-";

type Entry = { sessionId: string; carries: boolean };

function entryFromLine(line: string, isValidId: (id: string) => boolean): Entry[] {
  const [sessionId, marker, ...rest] = line.trim().split(/\s+/);
  // More than the two fields it should have means a truncated append or a hand-edit. Dropped
  // rather than guessed at, exactly as the tool-group parser does.
  if (rest.length > 0 || !sessionId || !isValidId(sessionId)) return [];
  if (marker === undefined) return [{ sessionId, carries: true }];
  return marker === ALL_TOOLS_RELEASE ? [{ sessionId, carries: false }] : [];
}

/**
 * The ids the file says currently carry the whole GUI MCP, replayed IN ORDER so a release drops a
 * claim that came before it — the ordering is the whole reason this is not a set union.
 */
export function parseAllToolsLog(contents: string, isValidId: (id: string) => boolean): string[] {
  const carrying = new Set<string>();
  for (const line of contents.split("\n")) {
    for (const { sessionId, carries } of entryFromLine(line, isValidId)) {
      if (carries) carrying.add(sessionId);
      else carrying.delete(sessionId);
    }
  }
  return [...carrying];
}

/**
 * What to append. The newline LEADS rather than trails, for the reason session-id-log.ts spells
 * out: whatever the file ended with, an appended entry starts its own line, so a write cut off
 * mid-flight costs one entry rather than welding two together.
 */
export function allToolsLogLine(sessionId: string, carries: boolean): string {
  return carries ? `\n${sessionId}` : `\n${sessionId} ${ALL_TOOLS_RELEASE}`;
}
