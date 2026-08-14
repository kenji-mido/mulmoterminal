// Where `muse` keeps its sessions, and the questions the list / resume / badge paths ask of them.
//
// muse is codex-shaped: it mints its own session id and tells nobody, so a fresh spawn is watched
// until a new row appears (spawn-muse.ts) and the mapping is logged so a cold reconnect can resume
// it. What it does NOT share with codex is where it writes that down — everything a reader wants
// is a row in ONE sqlite index, `~/.local/share/muse/session-index.db`:
//
//   session_id        muse's own id, the argument to `muse resume <id>`
//   workspace_root    the cwd it was started in — so the launcher's per-directory listing is a
//                     WHERE clause rather than a scan
//   model_id, title, updated_at_us   what a row in that listing shows
//   session_log_path  the session.jsonl the two header badges are folded out of (muse-usage.ts)
//
// Every query below is BY THOSE KEYS rather than `SELECT … FROM sessions` filtered in JS: the log
// this index points at reaches tens of megabytes on a working day, and the index grows with every
// session on the machine, so "read the whole table to answer one id" is paid by a watcher polling
// twice a second and by a badge poll per cell.
import os from "node:os";
import path from "node:path";
import { isRecord } from "../../common/isRecord.js";

/** Where muse keeps everything. `MUSE_HOME` is honoured for the same reason `GROK_HOME` is: a spec
 *  (and a sandboxed run) must be able to point the reads somewhere that is not the developer's own
 *  disk. Read at call time, not captured, so setting it in a test still takes effect. */
const museHome = (): string => process.env.MUSE_HOME || path.join(os.homedir(), ".local", "share", "muse");
const museSessionIndexPath = (): string => path.join(museHome(), "session-index.db");

export interface MuseSessionMeta {
  id: string;
  workspaceRoot: string | null;
  modelId: string | null;
  title: string;
  updatedAtUs: number | null;
}

type Row = Record<string, unknown>;

/**
 * One read-only query against the index, opened and closed around it.
 *
 * `node:sqlite` is imported here and nowhere else, and lazily: it is the only sqlite in the server
 * and a build running on a node without it must not fail to LOAD this module — an agent whose
 * history cannot be listed is a missing list, not a broken server.
 *
 * Every failure answers `[]` for the same reason: before the first muse session there is no
 * database at all, which is indistinguishable from a schema that moved, and both mean "nothing to
 * say" to every caller here.
 */
async function queryMuseIndex(sql: string, params: readonly string[] = []): Promise<Row[]> {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(museSessionIndexPath(), { readOnly: true });
    try {
      // Filtered rather than asserted: what sqlite hands back is a row shape this file does not
      // own, and every column is read through a guard below anyway.
      const rows: unknown[] = db.prepare(sql).all(...params);
      return rows.filter(isRecord);
    } finally {
      try {
        db.close();
      } catch {
        // A close that fails leaves the caller nothing to do — the read is already answered.
      }
    }
  } catch {
    return [];
  }
}

/** A non-empty string column, or null. Written once: every field below is a column muse may not
 *  have filled in yet, and a blank title or model must read as absent rather than as `""`. */
const text = (row: Row, key: string): string | null => {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value : null;
};

const metaOf = (row: Row): MuseSessionMeta | null => {
  const id = text(row, "session_id");
  if (!id) return null;
  return {
    id,
    workspaceRoot: text(row, "workspace_root"),
    modelId: text(row, "model_id"),
    title: text(row, "title") ?? id,
    updatedAtUs: typeof row.updated_at_us === "number" ? row.updated_at_us : null,
  };
};

/** muse's sessions for one working directory — the launcher's "or resume here" list. */
export async function listMuseSessionsForCwd(cwd: string): Promise<MuseSessionMeta[]> {
  const rows = await queryMuseIndex("SELECT session_id, workspace_root, model_id, title, updated_at_us FROM sessions WHERE workspace_root = ?", [cwd]);
  return rows.map(metaOf).filter((meta): meta is MuseSessionMeta => meta !== null);
}

/** Does muse hold a session by this id in this directory? The cold-resume probe: a row from the
 *  history list IS one of muse's own ids, and this is what separates it from a key that only ever
 *  named a MulmoTerminal session. The cwd is part of the question because `muse resume` is
 *  workspace-scoped, and resuming another directory's session in this one is not what the row on
 *  screen offered. */
export async function museSessionExistsForCwd(id: string, cwd: string): Promise<boolean> {
  const rows = await queryMuseIndex("SELECT 1 FROM sessions WHERE session_id = ? AND workspace_root = ? LIMIT 1", [id, cwd]);
  return rows.length > 0;
}

/** The session.jsonl behind one session, which is where its badges are folded from. */
export async function museSessionLogPath(id: string): Promise<string | null> {
  const rows = await queryMuseIndex("SELECT session_log_path FROM sessions WHERE session_id = ? LIMIT 1", [id]);
  return rows[0] ? text(rows[0], "session_log_path") : null;
}

/** The model the index records for a session — the badge's fallback for a session whose log has
 *  not carried a completed turn yet, where there is nothing to fold a model out of. */
export async function museSessionModel(id: string): Promise<string | null> {
  const rows = await queryMuseIndex("SELECT model_id FROM sessions WHERE session_id = ? LIMIT 1", [id]);
  return rows[0] ? text(rows[0], "model_id") : null;
}

/** The ids a workspace holds right now — the "before" of the spawn watcher. */
export async function snapshotMuseSessions(cwd: string): Promise<Set<string>> {
  const rows = await queryMuseIndex("SELECT session_id FROM sessions WHERE workspace_root = ?", [cwd]);
  return new Set(rows.map((row) => text(row, "session_id")).filter((id): id is string => id !== null));
}

/**
 * The id muse minted for a session we just started: the row in this workspace that was not there
 * before and that no other spawn has claimed — attributed ONLY when it is the only such row, the
 * same refusal codex and agy make (#1533). This watcher used to take the FIRST new row, and with
 * two spawns in one directory — or a `before` snapshot a busy sqlite answered empty — that guess
 * mapped a cell to somebody else's conversation, PERSISTED it, and every cold reconnect after
 * resumed the wrong one. Ambiguity keeps polling rather than failing: the other spawn's claim can
 * shrink the set to one.
 *
 * `claimed` is what keeps two cells started in the same directory at the same moment from both
 * taking the same row. It is claimed HERE, synchronously with the selection, not in the caller's
 * `.then` — two watchers awaiting the same poll tick would otherwise both pick the same row before
 * either claim landed.
 */
export async function watchForMuseSession(
  cwd: string,
  before: ReadonlySet<string>,
  opts: { claimed: Set<string>; isCancelled: () => boolean },
  timeoutMs = 15000,
  intervalMs = 500,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (opts.isCancelled()) return null;
    const current = await snapshotMuseSessions(cwd);
    const fresh = [...current].filter((id) => !before.has(id) && !opts.claimed.has(id));
    const sole = fresh.length === 1 ? fresh[0] : undefined;
    if (sole) {
      opts.claimed.add(sole);
      return sole;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}
