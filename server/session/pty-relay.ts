// The wire between a spawned agent's PTY and its WebSocket: output forwarded and buffered, exit
// forwarded and reaped. Identical for every first-class agent — the only thing that differed
// between the codex and antigravity copies was the word in the log line — so it lives here rather
// than being pasted into each new spawner.
//
// NOT shared with claude's spawner: that one drives hooks, transcripts and the draft injector off
// the same stream, and folding those in would make this the thing it exists to avoid. If a second
// agent ever needs one of them, move it here then.
import { handlePtyExit } from "./pty-exit.js";
import { wireBufferedOutput } from "./output-relay.js";
import { ptyExitLine } from "./pty-exit-log.js";
import { sendExitAndClose } from "./ws-frames.js";
import type { PtyEntry } from "./types.js";

export interface PtyRelayDeps {
  outputBufferLimit: number;
  reap: (sessionId: string) => void;
}

/** `spawnedAtMs` is carried in rather than read here: the exit line's most useful field is how long
 *  the process lived, and an agent that dies inside the startup window never started (#1078).
 *
 *  `onOutput` is the seed-injection tap: a spawner that types into the TUI watches the same stream
 *  for its ready-marker rather than attaching a second onData listener. */
export function wireAgentPtyRelay(entry: PtyEntry, sessionId: string, spawnedAtMs: number, deps: PtyRelayDeps, onOutput?: (data: string) => void): void {
  const output = wireBufferedOutput(entry, deps.outputBufferLimit, onOutput);
  entry.term.onExit(({ exitCode, signal }) => {
    console.log(ptyExitLine({ agent: entry.agent ?? "agent", exitCode, signal, lifetimeMs: Date.now() - spawnedAtMs, cwd: entry.cwd, sessionId }));
    output.flush(); // a queued batch must not arrive after the exit frame
    sendExitAndClose(entry.ws, exitCode, signal);
    // See spawn-claude's copy: a tmux client killed from outside is not a finished session (#1496).
    handlePtyExit(sessionId, deps.reap);
  });
}
