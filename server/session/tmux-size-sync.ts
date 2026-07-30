// A tmux window that fell out of step with its client never recovers on its own.
//
// tmux learns a client's size from SIGWINCH, and the kernel raises SIGWINCH only when the size
// actually CHANGES — so re-sending the size the pty already holds is silent. That was every
// repair the product had: the browser's ResizeObserver re-fits to the same size, a reload
// re-attaches and sends it again from `onopen`, and `tmuxRedrawClient` (#1073) repaints
// faithfully at the size tmux still believes in. What the user sees is content in the top-left
// corner and blank columns and rows everywhere else, with no way out but resizing the browser
// window by hand (#957).
//
// Measured on tmux 3.6a against a live disagreement (our client 120x40, the window 80x24): the
// re-send and `refresh-client` both left it at 80x24; shrinking the pty by a row and putting it
// straight back restored 120x40. `resize-window` also works and is deliberately NOT used — it
// switches that window to `window-size manual`, after which it stops following the client for
// good, which trades a rare bug for a permanent one.

export interface TerminalSize {
  cols: number;
  rows: number;
}

export type SizeSyncEvent =
  /** About to nudge: tmux and the client disagree. */
  | { kind: "repairing"; id: string; wanted: TerminalSize; seen: TerminalSize }
  /** The nudge did not take — the gap has a mechanism we don't know about yet. */
  | { kind: "still-wrong"; id: string; wanted: TerminalSize; seen: TerminalSize };

export interface TmuxSizeSyncDeps {
  /** What tmux says the window is, or null when it can't say. */
  windowSizeOf: (id: string) => Promise<TerminalSize | null>;
  /** Resize the session's pty. Called twice for one nudge; a no-op for a session that has gone. */
  resizePty: (id: string, size: TerminalSize) => void;
  /** Reported so a recurrence is attributable — this bug has been hard to pin down precisely
   *  because it leaves no trace of its own. */
  onEvent: (event: SizeSyncEvent) => void;
  settleMs?: number;
  nudgeMs?: number;
}

// Long enough that a splitter drag or a window resize costs one probe rather than one per frame,
// short enough that a reload's blank screen is repaired before the user reaches for the mouse.
const DEFAULT_SETTLE_MS = 250;
// Holding the intermediate size briefly keeps the two ioctls genuinely distinct, so the repair
// does not depend on how the kernel coalesces signals. Measured on tmux 3.6a, three attempts at
// each of 0/10/25/50/100/150ms: every gap repaired every time, so this is picked for margin
// rather than necessity — and it is short enough that the app's reflow is not seen.
const DEFAULT_NUDGE_MS = 50;

export const sizesAgree = (a: TerminalSize, b: TerminalSize): boolean => a.cols === b.cols && a.rows === b.rows;

/** One row in whichever direction exists. A one-row terminal can only grow. */
export const nudgedSize = ({ cols, rows }: TerminalSize): TerminalSize => ({ cols, rows: rows > 1 ? rows - 1 : rows + 1 });

// Who owns the newest request per session. A check is several awaits long, so clearing a timer
// cannot reach one that has already started — each request takes a ticket instead, and every step
// past an await asks whether it still holds the newest. Without that, a nudge would put the pty
// back to a size the client abandoned mid-flight, which is the disagreement this file exists to
// close, in the other direction.
//
// Tickets are counted across the whole process rather than per session. That is what makes
// `forget` safe: no number is ever handed out twice, so a resumed id cannot reissue one an
// in-flight check still holds — that check just fails the guard, which is the right answer.
function createTicketBook() {
  const holder = new Map<string, number>();
  let issued = 0;
  return {
    next: (id: string): number => {
      issued += 1;
      holder.set(id, issued);
      return issued;
    },
    holdsNewest: (id: string, ticket: number): boolean => holder.get(id) === ticket,
    knows: (id: string): boolean => holder.has(id),
    forget: (id: string): void => void holder.delete(id),
    size: (): number => holder.size,
  };
}

// A gap the nudge could NOT close is systematic rather than transient — a tmux whose status line
// is still on gives one, since the bar reserves a row and the window can then never equal the
// client. Retrying that on every resize would double-resize the app and repeat the same warning
// for the session's whole life, drowning the signal this logging exists to give. So an identical
// (client, window) pair is reported once and left alone until either size changes.
//
// Measured on a real spawn: a tmux server predating `status off` sat at window 137x40 against a
// 137x41 client, and the nudge did not move it.
function createUnclosableGaps() {
  const seen = new Map<string, string>();
  const key = (client: TerminalSize, window: TerminalSize): string => `${client.cols}x${client.rows}|${window.cols}x${window.rows}`;
  return {
    alreadyReported: (id: string, client: TerminalSize, window: TerminalSize): boolean => seen.get(id) === key(client, window),
    remember: (id: string, client: TerminalSize, window: TerminalSize): void => void seen.set(id, key(client, window)),
    clear: (id: string): void => void seen.delete(id),
  };
}

export function createTmuxSizeSync(deps: TmuxSizeSyncDeps) {
  const settleMs = deps.settleMs ?? DEFAULT_SETTLE_MS;
  const nudgeMs = deps.nudgeMs ?? DEFAULT_NUDGE_MS;
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const tickets = createTicketBook();
  const unclosable = createUnclosableGaps();
  // The newest size the client asked for, so an in-flight nudge lands on THAT rather than on the
  // size it captured when it started.
  const wanted = new Map<string, TerminalSize>();
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  // The invariant: every step that follows an `await` either re-checks the ticket or is correct
  // for any ticket. There is exactly one of the latter, marked below — anything else added here
  // needs a guard.
  async function nudge(id: string, target: TerminalSize, seen: TerminalSize, ticket: number): Promise<void> {
    deps.onEvent({ kind: "repairing", id, wanted: target, seen });
    deps.resizePty(id, nudgedSize(target));
    await wait(nudgeMs);
    // Deliberately UNGUARDED, and correct for any ticket: the pty must never be left a row short
    // of the browser, and the size it lands on is read fresh rather than captured — a resize frame
    // that arrived mid-nudge has already set the real one, and restoring the captured size would
    // undo it.
    deps.resizePty(id, wanted.get(id) ?? target);
    if (!tickets.holdsNewest(id, ticket)) return; // superseded: skip the probe a newer check will make anyway
    await wait(nudgeMs);
    const after = await deps.windowSizeOf(id);
    // Guarded AGAIN, because two awaits separate this from the check above. `still-wrong` is the
    // signal that the repair itself failed — a false one sends the next investigator after a
    // mechanism that isn't there, so it must never name a size the client has already left.
    if (!tickets.holdsNewest(id, ticket)) return;
    if (!after || sizesAgree(after, target)) return;
    unclosable.remember(id, target, after);
    deps.onEvent({ kind: "still-wrong", id, wanted: target, seen: after });
  }

  async function check(id: string, target: TerminalSize, ticket: number): Promise<void> {
    const seen = await deps.windowSizeOf(id);
    if (!tickets.holdsNewest(id, ticket)) return;
    if (!seen || sizesAgree(seen, target)) {
      unclosable.clear(id); // back in step: a gap seen later is news again
      return;
    }
    if (unclosable.alreadyReported(id, target, seen)) return;
    await nudge(id, target, seen, ticket);
  }

  /** Drop a settling check, and abandon one that has already started. Called on every socket
   *  close, including sessions with no tmux and therefore no check ever — so it must allocate
   *  nothing for an id it has not seen, or the maps would grow with every disconnect. */
  function cancel(id: string): void {
    const timer = pending.get(id);
    if (timer !== undefined) clearTimeout(timer);
    pending.delete(id);
    if (tickets.knows(id)) tickets.next(id);
  }

  /** The session is gone for good (reaped). A `cancel` alone keeps the ticket, because a detached
   *  session can still reattach; this is the teardown that actually frees the state. */
  function forget(id: string): void {
    cancel(id);
    tickets.forget(id);
    wanted.delete(id);
    unclosable.clear(id);
  }

  /** Call on every resize frame; only the last of a burst is acted on. */
  function requestCheck(id: string, target: TerminalSize): void {
    const timer = pending.get(id);
    if (timer !== undefined) clearTimeout(timer);
    wanted.set(id, target);
    const ticket = tickets.next(id);
    pending.set(
      id,
      setTimeout(() => {
        pending.delete(id);
        // A probe that throws must not take the process down with it — the session is still fine,
        // it just keeps the screen it has until the next resize.
        check(id, target, ticket).catch(() => {});
      }, settleMs),
    );
  }

  // `trackedSessionCount` exists so "a cancel must not allocate, and a reap must free" is tested
  // rather than asserted in a comment — nothing in the app reads it.
  return { requestCheck, cancel, forget, trackedSessionCount: tickets.size };
}
