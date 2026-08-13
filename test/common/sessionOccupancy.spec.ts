import { describe, it, expect } from "vitest";
import { isSessionAttached } from "../../common/sessionOccupancy";

// The rule that decides whether a launcher row may be clicked. Getting it wrong in one direction
// hands a running agent's terminal to a second cell (#1207); in the other it locks someone out of
// a worktree nobody is in, with nothing to click and no reason on screen.
describe("isSessionAttached", () => {
  const free = { viewedHere: false, tmuxClients: 0, holdsTmuxClient: false };

  it("is attached when a socket in this process still has it", () => {
    expect(isSessionAttached({ ...free, viewedHere: true })).toBe(true);
  });

  it("is free when nothing holds it", () => {
    expect(isSessionAttached(free)).toBe(false);
  });

  // Our own pty IS a tmux client, so a session this process merely KEEPS ALIVE (working with its
  // browser gone) reports one client. Counting that as somebody else would make a session
  // permanently unresumable by the very process holding it.
  it("does not count our own tmux client as another holder", () => {
    expect(isSessionAttached({ viewedHere: false, tmuxClients: 1, holdsTmuxClient: true })).toBe(false);
  });

  // The cross-process case: a second mulmoterminal attached to the same tmux session. Both are
  // clients, so the count exceeds the one we hold.
  it("sees a client belonging to another process", () => {
    expect(isSessionAttached({ viewedHere: false, tmuxClients: 2, holdsTmuxClient: true })).toBe(true);
    expect(isSessionAttached({ viewedHere: false, tmuxClients: 1, holdsTmuxClient: false })).toBe(true);
  });

  // Deliberately permissive: without tmux there is no session that outlives this process for a
  // second one to attach to, so an unreadable answer must not refuse the directory.
  it("reads an unreadable tmux answer as free", () => {
    expect(isSessionAttached({ viewedHere: false, tmuxClients: null, holdsTmuxClient: false })).toBe(false);
    expect(isSessionAttached({ viewedHere: false, tmuxClients: null, holdsTmuxClient: true })).toBe(false);
  });

  it("still reports a socket in this process when tmux cannot answer", () => {
    expect(isSessionAttached({ viewedHere: true, tmuxClients: null, holdsTmuxClient: false })).toBe(true);
  });
});
