// The seam GridView is reached through: a module-level handler the grid registers when it is there,
// and a queue for the requests that arrive when it isn't. Two of these exist — useNewTerminal (spawn
// a cell here) and useSpawnedChat (adopt an already-spawned session as a cell) — and they had the
// same twenty lines each (#1289).
//
// The queue holds EVERY waiting request, not just the newest. One slot was enough while a person
// pressing a button was the only caller — nobody can press twice before the route changes — but the
// phone asks over pub/sub (#831) and a collection action can start several chats at once, and each
// command is answered with success, so a dropped request is work reported as done that never happened.

export interface HandlerQueue<Req, Ret> {
  /** Register the live handler and drain everything queued before it, in arrival order. The
   *  returned function unregisters it (from onBeforeUnmount / onDeactivated). */
  register: (h: (req: Req) => Ret) => () => void;
  /** Hand the request to the live handler and return its answer, or queue it and return
   *  `queuedResult` — what the caller considers true of a request that is merely waiting. */
  deliver: (req: Req, queuedResult: Ret) => Ret;
  /** Test seam: drop anything a previous case left queued. Not used by the app. */
  reset: () => void;
}

export function createHandlerQueue<Req, Ret>(): HandlerQueue<Req, Ret> {
  let handler: ((req: Req) => Ret) | null = null;
  let pending: Req[] = [];

  return {
    register(h) {
      handler = h;
      // Taken before dispatching: a handler that itself queues (it can reach the opener through the
      // grid) would otherwise have its request dropped by the clear below.
      const queued = pending;
      pending = [];
      // Not `queued.forEach(h)`: forEach would hand the handler the index and the array too.
      queued.forEach((req) => h(req));
      // Only if it is still the current one — a stale unregister must not detach its successor.
      return () => {
        if (handler === h) handler = null;
      };
    },
    deliver(req, queuedResult) {
      if (handler) return handler(req);
      pending.push(req);
      return queuedResult;
    },
    reset() {
      handler = null;
      pending = [];
    },
  };
}
