// Frames that arrive before the session they belong to exists.
//
// The browser treats a WebSocket as usable the moment it opens and sends its first frame right
// away — a `resize` carrying the terminal's real geometry (see useTerminalConnections). The
// server, meanwhile, may still be deciding what to spawn: a grid codex cell reads its directory's
// registered tool groups off disk first. Anything that lands in that window is delivered to a
// listener that does not exist yet and is simply lost, and a lost resize leaves the pty on its
// default 80x24 while the browser draws the real size.
//
// So the socket is listened to from the start, into a buffer, and the buffer is replayed in
// arrival order once there is a pty to give it to.
import type { RawData, WebSocket } from "ws";

export interface EarlyFrames {
  /** Replay what arrived, in order, and stop buffering. Safe to call when nothing arrived. */
  release: (deliver: (raw: RawData) => void) => void;
  /** Drop what arrived and stop buffering — for a connection that never gets its session. */
  discard: () => void;
}

// `RawData` rather than a generic: it is what the socket actually hands the listener, and an
// unconstrained `T` could not receive it — which is what the two assertions here were undoing.
// A caller wanting something narrower still passes its own handler to `release` (a function
// accepting the wider type is usable where the narrower one is expected).
export function bufferEarlyFrames(ws: Pick<WebSocket, "on" | "off">): EarlyFrames {
  const pending: RawData[] = [];
  const collect = (raw: RawData) => pending.push(raw);
  ws.on("message", collect);
  const stop = () => ws.off("message", collect);
  return {
    release(deliver) {
      // Detached BEFORE the replay: a frame arriving mid-replay must reach the real listener the
      // caller is about to install, not land back in a buffer nobody drains again.
      stop();
      for (const raw of pending) deliver(raw);
      pending.length = 0;
    },
    discard() {
      stop();
      pending.length = 0;
    },
  };
}
