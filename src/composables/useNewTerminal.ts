// A seam for opening a new grid terminal cell from anywhere — the header "new terminal" button
// (open.terminal). The new cell runs the OS default shell ($SHELL) in `cwd`. GridView owns the grid
// state, so it REGISTERS a handler here; the button just calls openTerminalAt(). The new cell opens
// next to the cell identified by `afterSlotKey` (the durable slot key "cell-<uid>"), or at the end when
// that can't be resolved (e.g. the single view, whose slot key isn't a grid cell).
//
// When the grid isn't mounted (the button pressed from the single view), the request is QUEUED and the
// app switches to /terminals; GridView drains the queue when it registers on mount — mirroring
// usePendingScript for the single view's Run menu. The queueing itself is createHandlerQueue, shared
// with useSpawnedChat.
import { router } from "../router";
import { createHandlerQueue, type HandlerQueue } from "./handlerQueue";
import type { LaunchAgent } from "../../common/launchAgent";

export interface NewTerminalRequest {
  cwd: string;
  afterSlotKey: string | null;
  // What the new cell runs. Omitted means the OS default shell, which is what the header
  // button has always opened; the phone can also ask for claude or codex (#831).
  agent?: LaunchAgent | undefined;
}
type Handler = (req: NewTerminalRequest) => void;

// Annotated rather than `createHandlerQueue<NewTerminalRequest, void>()`: `void` is only valid as a
// type argument of a type reference, not of a call.
const queue: HandlerQueue<NewTerminalRequest, void> = createHandlerQueue();

// GridView registers its opener; every request queued before it mounted drains immediately, in
// arrival order. The returned function unregisters it (call in onBeforeUnmount).
export function registerNewTerminalHandler(h: Handler): () => void {
  return queue.register(h);
}

// Open a new terminal cell in `cwd`, next to `afterSlotKey`'s cell — running `agent`, or the OS
// default shell when it is omitted. If the grid isn't mounted yet, queue the request and switch to it.
export function openTerminalAt(cwd: string, afterSlotKey: string | null, agent?: LaunchAgent): void {
  queue.deliver({ cwd, afterSlotKey, agent }, undefined);
  // Then SHOW the grid. Mounted is not the same as on screen: it now stays alive underneath a
  // full-screen overlay, so the phone's launch (#831) would be reported as served while the new
  // terminal appeared behind the wiki or the collection browser, seen by nobody. Before the grid
  // survived an overlay, the queue-and-navigate branch did this by accident (Codex, PR #1193).
  if (router.currentRoute.value.name !== "terminals") router.push("/terminals").catch(() => {});
}
