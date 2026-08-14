// @vitest-environment node
// The spawn watcher that maps a MulmoTerminal session key to the id muse minted for it. It used
// to take the FIRST new row in the workspace — with two spawns in one directory, or a `before`
// snapshot a busy sqlite answered empty, that guess mapped a cell to somebody else's conversation
// and PERSISTED it, so every cold reconnect after resumed the wrong one (#1533). Now it attributes
// only an unambiguous sole row, and claims it synchronously with the selection — the same rules
// codex and agy already had.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { snapshotMuseSessions, watchForMuseSession } from "../../../server/agents/muse-session.js";

const WS = "/work/project";
const OTHER_WS = "/work/other";

let home: string;
let priorMuseHome: string | undefined;

const withDb = (fn: (db: DatabaseSync) => void): void => {
  const db = new DatabaseSync(path.join(home, "session-index.db"));
  try {
    fn(db);
  } finally {
    db.close();
  }
};

const addSession = (id: string, workspace: string): void => {
  withDb((db) => db.prepare("INSERT INTO sessions (session_id, workspace_root) VALUES (?, ?)").run(id, workspace));
};

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "mt-muse-"));
  priorMuseHome = process.env.MUSE_HOME;
  process.env.MUSE_HOME = home;
  withDb((db) => db.exec("CREATE TABLE sessions (session_id TEXT, workspace_root TEXT)"));
});

afterEach(() => {
  if (priorMuseHome === undefined) delete process.env.MUSE_HOME;
  else process.env.MUSE_HOME = priorMuseHome;
  rmSync(home, { recursive: true, force: true });
});

const opts = (claimed: Set<string>) => ({ claimed, isCancelled: () => false });

describe("watchForMuseSession", () => {
  it("attributes the sole fresh row, and claims it synchronously with the selection", async () => {
    addSession("old-1", WS);
    const before = await snapshotMuseSessions(WS);
    addSession("new-1", WS);
    const claimed = new Set<string>();
    expect(await watchForMuseSession(WS, before, opts(claimed), 500, 10)).toBe("new-1");
    expect(claimed.has("new-1")).toBe(true);
  });

  // The failure #1533 was filed over: taking the FIRST of several new rows is a guess, and the
  // wrong guess is persisted. Codex and agy refuse the same way.
  it("refuses to guess between two fresh rows", async () => {
    const before = await snapshotMuseSessions(WS);
    addSession("new-1", WS);
    addSession("new-2", WS);
    expect(await watchForMuseSession(WS, before, opts(new Set()), 60, 10)).toBeNull();
  });

  // Ambiguity is a state, not a verdict: the other spawn's claim shrinks the set to one, which is
  // why the watcher keeps polling instead of returning null on the first ambiguous read.
  it("resolves once another spawn's claim leaves exactly one row", async () => {
    const before = await snapshotMuseSessions(WS);
    addSession("new-1", WS);
    addSession("new-2", WS);
    expect(await watchForMuseSession(WS, before, opts(new Set(["new-1"])), 500, 10)).toBe("new-2");
  });

  // The empty-snapshot hole: a busy sqlite answers `before = ∅`, and every EXISTING row then reads
  // as new. Rows already claimed — the registry seeds the set from the persisted conversation log —
  // must not be re-attributed to a fresh spawn.
  it("never attributes a row another session already claims, even from an empty snapshot", async () => {
    addSession("someone-elses", WS);
    expect(await watchForMuseSession(WS, new Set(), opts(new Set(["someone-elses"])), 60, 10)).toBeNull();
  });

  it("ignores another workspace's rows", async () => {
    const before = await snapshotMuseSessions(WS);
    addSession("new-1", OTHER_WS);
    expect(await watchForMuseSession(WS, before, opts(new Set()), 60, 10)).toBeNull();
  });
});
