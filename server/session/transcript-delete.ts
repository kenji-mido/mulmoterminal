// Permanently delete a session's on-disk record — the destructive counterpart to hiding.
// Removing the transcript is what actually drops it from `claude --resume` (and from the
// sidebar, which lists transcripts). The id is a UUID, unique across projects, so we find the
// file by scanning rather than needing the caller to know its cwd.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { codexRolloutPath } from "../agents/codex-sessions.js";
import { codexSessionsRoot } from "../agents/codex-session.js";

// Delete `~/.claude/projects/<any>/<id>.jsonl` (Claude) and the codex rollout for `id`, if
// present. Best-effort and idempotent — an already-gone file is success, not an error. Returns
// whether anything was removed.
export function deleteSessionTranscripts(id: string): boolean {
  let removed = false;

  const projects = path.join(os.homedir(), ".claude", "projects");
  let dirs: string[];
  try {
    dirs = fs.readdirSync(projects);
  } catch {
    dirs = []; // no projects dir → nothing to remove here
  }
  for (const d of dirs) {
    const file = path.join(projects, d, `${id}.jsonl`);
    try {
      fs.unlinkSync(file);
      removed = true;
      break; // a UUID is unique — at most one match
    } catch {
      // not in this project dir — keep looking
    }
  }

  // codex keeps its own rollout elsewhere; drop it too when the id maps to one.
  const rollout = codexRolloutPath(codexSessionsRoot(), id);
  if (rollout) {
    try {
      fs.unlinkSync(rollout);
      removed = true;
    } catch {
      // already gone / unreadable — best-effort
    }
  }

  return removed;
}
