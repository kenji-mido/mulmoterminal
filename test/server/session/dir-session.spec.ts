import { describe, it, expect } from "vitest";
import { pickDirSession, type DirSessionCandidate } from "../../../server/session/dir-session";

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
