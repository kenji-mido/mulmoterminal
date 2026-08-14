// @vitest-environment node
import { describe, it, expect } from "vitest";
import { grokSurvivorCandidates, pickDirSession, survivorCandidates, type DirSessionCandidate, type SurvivorLog } from "../../../server/session/dir-session";
import { canonicalPath } from "../../../server/infra/canonical-path";
import type { AgentConversation } from "../../../server/session/agent-conversations";

const candidate = (over: Partial<DirSessionCandidate> & { id: string }): DirSessionCandidate => ({
  attached: false,
  agent: "claude",
  live: false,
  mtime: 0,
  ...over,
});

// A worktree is one branch, so the launcher asks this for ONE session — and which one it names
// decides whether the row resumes, or refuses (#1207).
describe("pickDirSession", () => {
  it("has no session for a directory with no candidates", () => {
    expect(pickDirSession([])).toBeNull();
  });

  it("takes the most recent when nothing is running", () => {
    const picked = pickDirSession([candidate({ id: "old", mtime: 10 }), candidate({ id: "new", mtime: 20 })]);
    expect(picked).toEqual({ id: "new", attached: false, agent: "claude" });
  });

  // The held one is what a second terminal would collide with. A newer transcript in the same
  // directory must not hide it, or the row goes back to offering a session it cannot give.
  it("prefers a held session over a more recent free one", () => {
    const picked = pickDirSession([candidate({ id: "newer", mtime: 99 }), candidate({ id: "held", mtime: 1, attached: true })]);
    expect(picked).toEqual({ id: "held", attached: true, agent: "claude" });
  });

  // A live pty with no transcript yet (nobody has prompted it) has nothing to be recent BY, so
  // recency alone would let an old finished conversation stand in for the session running now.
  it("prefers a live session over an older transcript", () => {
    const picked = pickDirSession([candidate({ id: "disk", mtime: 50 }), candidate({ id: "live", mtime: 0, live: true })]);
    expect(picked?.id).toBe("live");
  });

  it("carries the agent, so the row resumes as what the session actually is", () => {
    expect(pickDirSession([candidate({ id: "cx", live: true, agent: "codex" })])?.agent).toBe("codex");
  });

  // Two candidates for one session — its live pty and its transcript — are not deduped, because
  // both answer the same and picking either is the same row.
  it("answers the same when a session appears both live and on disk", () => {
    const picked = pickDirSession([candidate({ id: "s1", live: true, mtime: 5, attached: true }), candidate({ id: "s1", mtime: 7, attached: true })]);
    expect(picked).toEqual({ id: "s1", attached: true, agent: "claude" });
  });
});

// A codex/agy/muse session whose tmux outlived its pty (#1496) or the whole server. `ptys` cannot
// see it and no transcript pass can — the conversation log is the one record tying the surviving
// key to a directory. Reading it as "no session here" is how a worktree admitted a second agent
// beside a running one, and how a conversation ended up with two backends (#1533).
describe("survivorCandidates", () => {
  // The `dir` argument is CANONICAL by contract — `dirSession` hands it `canonicalPath(dir)` and
  // this pass canonicalizes only the record's side — so the spec has to canonicalize it too. A raw
  // POSIX literal compared `/wt/fix-login` against Windows's `D:\wt\fix-login`, which made every
  // case here return nothing: the two positive cases failed, and the four negative ones passed for
  // the wrong reason (#1539). The RECORD keeps its raw spelling, which is what the log really
  // holds.
  const WORKTREE = canonicalPath("/wt/fix-login");
  const ELSEWHERE = canonicalPath("/wt/other");
  const record = (over: Partial<AgentConversation> = {}): AgentConversation => ({
    sessionId: "key-1",
    conversationId: "conv-1",
    cwd: "/wt/fix-login",
    startedAt: 0,
    ...over,
  });
  const logs = (records: AgentConversation[], agent: SurvivorLog["agent"] = "codex"): SurvivorLog[] => [
    { agent, records: records.map((r) => [r.sessionId, r] as const) },
  ];
  const facts = (over: Partial<Parameters<typeof survivorCandidates>[2]> = {}): Parameters<typeof survivorCandidates>[2] => ({
    running: new Set(["key-1"]),
    liveHere: () => false,
    userSession: () => true,
    attached: () => false,
    now: 42,
    ...over,
  });

  it("names a running survivor as a LIVE candidate of its own agent", () => {
    const found = survivorCandidates(WORKTREE, logs([record()]), facts());
    expect(found).toEqual([{ id: "key-1", live: true, mtime: 42, agent: "codex", attached: false }]);
  });

  it("ignores a session that is not running — a dead key is the transcript passes' business", () => {
    expect(survivorCandidates(WORKTREE, logs([record()]), facts({ running: new Set() }))).toEqual([]);
  });

  // The live pass already names it, better: its pty knows the directory it ACTUALLY runs in,
  // where the log knows the one it was claimed in.
  it("leaves a session with a live pty to the live pass", () => {
    expect(survivorCandidates(WORKTREE, logs([record()]), facts({ liveHere: () => true }))).toEqual([]);
  });

  it("ignores another directory's survivor", () => {
    expect(survivorCandidates(ELSEWHERE, logs([record()]), facts())).toEqual([]);
  });

  // The record holds whatever spelling the spawn was handed, so the match has to survive one — and
  // a spec whose two sides are the same literal cannot tell a real comparison from one that always
  // answers the same way, which is exactly how the Windows failure hid (#1539).
  it("matches a record whose cwd spells the directory another way", () => {
    const found = survivorCandidates(WORKTREE, logs([record({ cwd: "/wt/other/../fix-login" })]), facts());
    expect(found.map((c) => c.id)).toEqual(["key-1"]);
  });

  it("excludes helper sessions, like every other pass", () => {
    expect(survivorCandidates(WORKTREE, logs([record()]), facts({ userSession: () => false }))).toEqual([]);
  });

  // The point of the pass meeting the point of the rank: the surviving backend must beat a newer
  // transcript, or the worktree row offers the conversation written to most recently while a
  // different one is still running (#1533).
  it("outranks a merely recent transcript once picked with", () => {
    const survivor = survivorCandidates(WORKTREE, logs([record()]), facts())[0];
    const picked = pickDirSession([candidate({ id: "disk", mtime: 99 }), survivor]);
    expect(picked?.id).toBe("key-1");
  });
});

// grok's survivors, found by probing its cwd-partitioned store rather than a conversation log —
// grok keeps none: the session key IS its conversation id. Excluded from the log pass, a grok
// session that outlived its pty read as "no session here" and the worktree admitted a second
// agent beside it (#1534 review).
describe("grokSurvivorCandidates", () => {
  const grokFacts = (over: Partial<Parameters<typeof grokSurvivorCandidates>[0]> = {}): Parameters<typeof grokSurvivorCandidates>[0] => ({
    running: new Set(["g-1"]),
    liveHere: () => false,
    userSession: () => true,
    attached: () => false,
    conversationInDir: (id) => id === "g-1",
    now: 42,
    ...over,
  });

  it("names a running survivor whose conversation lives in this directory", () => {
    expect(grokSurvivorCandidates(grokFacts())).toEqual([{ id: "g-1", live: true, mtime: 42, agent: "grok", attached: false }]);
  });

  it("ignores a key the store does not tie to this directory", () => {
    expect(grokSurvivorCandidates(grokFacts({ conversationInDir: () => false }))).toEqual([]);
  });

  it("leaves a session with a live pty to the live pass", () => {
    expect(grokSurvivorCandidates(grokFacts({ liveHere: () => true }))).toEqual([]);
  });

  it("excludes helper sessions, like every other pass", () => {
    expect(grokSurvivorCandidates(grokFacts({ userSession: () => false }))).toEqual([]);
  });
});
