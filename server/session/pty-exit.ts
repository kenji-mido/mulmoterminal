// What a dead pty means (#1496).
//
// Under tmux our pty is the tmux CLIENT, not the agent — so a pty that exits says one of two very
// different things, and the exit handlers used to read both as the same one:
//
//   - the program inside ended, and tmux closed the session with it   → tear the session down
//   - something killed our client while the session kept running      → keep it, drop the client
//
// The second is not hypothetical: `[pty] claude exited code=0 signal=9` is a SIGKILL, and nothing
// here sends one (node-pty's `kill()` sends SIGHUP), so it came from outside — macOS ending a
// process under memory pressure, in the reported case. Reaping there kills a tmux session with a
// live agent in it, and forgets the title, which is what drops the row from the phone's list.
import { ptys } from "./registry.js";
import { tmuxHasSession } from "../infra/tmux.js";

/** What the pty's death is evidence of. */
export type PtyExitDisposition = "reap" | "keep" | "gone";

/**
 * Pure, because it is the whole decision: which of the two events just happened.
 *
 * `gone` is the third case and not an edge one — an explicit close reaps the session and only then
 * does the pty die, so the exit arrives with nothing left to act on.
 */
export function ptyExitDisposition(facts: { stillRegistered: boolean; tmuxBacked: boolean; tmuxAlive: boolean }): PtyExitDisposition {
  if (!facts.stillRegistered) return "gone";
  return facts.tmuxBacked && facts.tmuxAlive ? "keep" : "reap";
}

/**
 * Apply that decision. `reap` is passed in rather than imported because it belongs to the lifecycle
 * the spawners already receive it from — and because it is the half that must NOT run for a session
 * that is still alive.
 */
export function handlePtyExit(sessionId: string, reap: (id: string) => void): PtyExitDisposition {
  const entry = ptys.get(sessionId);
  const tmuxBacked = !!entry?.tmux;
  const disposition = ptyExitDisposition({
    stillRegistered: !!entry,
    tmuxBacked,
    // Asked only when it can matter: a non-tmux pty has nothing that could outlive it, and this
    // shells out.
    tmuxAlive: tmuxBacked && tmuxHasSession(sessionId),
  });
  if (disposition === "keep") {
    // The entry has to go even though the session stays: `ptys.has()` is what every reconnect path
    // reads as "there is a live pty here", and a dead one left in the table would be reused instead
    // of reattached.
    ptys.delete(sessionId);
    console.log(`[pty] ${sessionId} lost its client, but its tmux session is still running — keeping it (reattaches on the next connect)`);
  } else if (disposition === "reap") {
    reap(sessionId);
  }
  return disposition;
}
