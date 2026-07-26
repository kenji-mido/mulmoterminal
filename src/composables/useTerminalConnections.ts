// A module-singleton manager that owns each terminal's durable runtime — its
// WebSocket, xterm instance, reconnect/backoff state — independent of the Vue
// component lifecycle. This is what lets a session's PTY stay alive (and its
// socket stay open) while its Terminal.vue is unmounted: navigating away, flipping
// to an off-page grid tab, or toggling Grid<->single only DETACHES the view (the
// xterm's host element is re-parented out of the DOM), it does not close the socket.
//
// Why this matters: the server keeps a PTY alive for exactly as long as its
// WebSocket is open (it only arms the reap grace timer on socket close). So holding
// the socket open here means coming back reattaches an already-live session — no
// `claude --resume`, no "restoring session" token cost — instead of a cold resume.
//
// Each terminal "slot" is addressed by a stable key: the grid cell's uid
// (`cell-<uid>`), the single view's `single`, or an ephemeral id for command/Run
// terminals (which are NOT persisted — their process is unresumable, so their slot
// is released on unmount like before).
import { reactive } from "vue";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ClipboardAddon, type IClipboardProvider } from "@xterm/addon-clipboard";
import { swallowsMouseTracking } from "./mouseTrackingModes";
import { clearResetModes, recordSwallowedModes, TouchScrollTracker, wantsWheelReports, wheelReportSequence } from "./wheelReports";
import { CanvasAddon } from "@xterm/addon-canvas";
import "@xterm/xterm/css/xterm.css";
import { connWsUrl, type LaunchChoice } from "../components/wsUrl";
import { reconnectDelayMs, shouldReconnect } from "./reconnectPolicy";
import type { RunCommand } from "../components/runCommand";
import { readableSlot, type SlotCandidate, type SlotInfo } from "./readableSlot";
import { messageEffect, type ParsedServerMessage } from "./serverMessage";
import { enterKeyOverride, submitSequence, DEFAULT_TERMINAL_SUBMIT_MODE, type EnterKeyEvent, type TerminalSubmitMode } from "../../common/terminalSubmit";
import { getTerminalSubmitMode } from "./terminalSubmitMode";
import { createFilePathLinkProvider } from "./terminalFilePathLinkProvider";

// "superseded" is a distinct terminal state — the session is alive but another window took it
// over — so the view can offer a one-click Reconnect (a plain "disconnected" drop auto-retries).
export type ConnStatus = "connecting" | "connected" | "disconnected" | "superseded";

// Enter submits and Shift/Option+Enter make a newline — but which BYTES carry each meaning
// depends on the host's Claude binding, so the choice lives in `enterKeyOverride` (keyed by
// the user's `terminalSubmit` setting) rather than being hardcoded here. xterm emits "\r" for
// both Enter and Shift+Enter, so whenever we need anything else we intercept the key and send
// the right bytes ourselves.
//
// The handler: when `enterKeyOverride` returns bytes, `send` them and return false to cancel
// xterm's default \r; otherwise return true so xterm handles the key normally.
// `preventDefault()` is essential: xterm's _keyDown returns early on a false custom handler
// WITHOUT preventDefault, so the browser fires a follow-up keypress that _keyPress turns into a
// bare \r — submitting the prompt. Cancelling the default stops that keypress.
type EnterHandlerEvent = EnterKeyEvent & { preventDefault: () => void };
export function makeEnterHandler(getMode: () => TerminalSubmitMode, send: (data: string) => void): (e: EnterHandlerEvent) => boolean {
  return (e) => {
    const bytes = enterKeyOverride(getMode(), e);
    if (bytes === null) return true;
    e.preventDefault();
    send(bytes);
    return false;
  };
}

// What a slot connects to. Mirrors the relevant Terminal.vue props; a connectKey
// change (session switch / relaunch) hands a fresh target to retarget().
export interface ConnTarget {
  sessionId: string | null;
  cwd: string | null;
  devTerminal: boolean;
  command: RunCommand | null;
  // A configured launcher (shell/codex/command) by index, or the OS default shell
  // (`{ shell: true }`, the header "new terminal" button). Unlike `command` this is a
  // PERSISTENT session — it reconnects on drop and reattaches by session id, like a Claude cell.
  launcher: { index: number } | { shell: true } | null;
  // A first-class codex session (/ws/codex) instead of a Claude one. Persistent &
  // reattachable like a Claude cell; the server discovers + resumes codex's own id.
  codex?: boolean;
  // The provider/model the launch form picked for this session (#584). Claude only —
  // it rides the /ws query and overrides the directory's default.
  launch?: LaunchChoice | null;
}

// The `terminalSubmit` mapping describes the user's CLAUDE binding, so it only applies to
// Claude cells. A launcher / codex / command / dev-terminal cell is a shell or another TUI
// where a bare Enter must stay xterm's native \r — a reversed setting must not rewrite it.
export const isClaudeTarget = (t: ConnTarget): boolean => !t.devTerminal && !t.command && !t.launcher && !t.codex;

// The submit/newline byte mapping in effect for one connection: the user's `terminalSubmit`
// setting for a Claude cell, the standard binding for everything else. Used by the keyboard
// handler AND the GUI-originated sends (submitText / pasteAndSubmit), so all three agree on
// which byte submits.
const effectiveSubmitMode = (c: Conn): TerminalSubmitMode => (isClaudeTarget(c.target) ? getTerminalSubmitMode() : DEFAULT_TERMINAL_SUBMIT_MODE);
const submitBytesFor = (c: Conn): string => submitSequence(effectiveSubmitMode(c));

// Forwarded to whatever component is currently attached, so the parent's existing
// session/cwd/exit wiring (grid_v2 persistence, recent-dir recording, re-run UI)
// keeps working unchanged. Cleared on detach; a detached slot still tracks its
// knownSessionId internally for a later reattach.
export interface ConnHandlers {
  onSession?: (id: string) => void;
  onCwd?: (cwd: string) => void;
  onExit?: () => void;
}

interface Conn {
  key: string;
  term: Terminal;
  fitAddon: FitAddon;
  host: HTMLDivElement; // term.open()'d into this ONCE; re-parented on attach/detach
  ws: WebSocket | null;
  knownSessionId: string | null;
  knownCwd: string | null; // server-resolved cwd, replayed on (re)attach
  target: ConnTarget;
  handlers: ConnHandlers;
  sawExit: boolean; // an intentional end (exit/superseded/error) — suppress reconnect
  released: boolean; // torn down — suppress reconnect and stray socket events
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  attachedEl: HTMLElement | null;
  // Mouse modes swallowed for the CURRENT session (#729/#737). Session-scoped: an app that
  // dies without sending DECRST must not leave the next one looking like it asked for mouse
  // reports, or its wheel would get synthesized reports it never wanted.
  swallowedMouseModes: Set<number>;
}

// The heavy per-slot runtime (non-reactive — Vue never needs to track these).
const conns = new Map<string, Conn>();

// Fit the terminal to its host, push the new size to the PTY, and stick to the
// bottom. The fit() can throw when the host isn't laid out yet — the caller's
// ResizeObserver fit() then follows — so it's swallowed.
function fitAndSyncSize(c: Conn): void {
  try {
    c.fitAddon.fit();
  } catch {
    // host not laid out yet
  }
  if (c.ws?.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "resize", cols: c.term.cols, rows: c.term.rows }));
  c.term.scrollToBottom();
}

// The reactive projection the view binds to (status pill, RunMenu cwd, resume-stuck banner).
// Keyed by the same slot key; a slot that hasn't connected yet (or was released) is absent.
export const connView = reactive(new Map<string, { status: ConnStatus; serverCwd: string | null; needsPrompt?: boolean }>());

function setStatus(c: Conn, s: ConnStatus) {
  const v = connView.get(c.key);
  if (v) v.status = s;
}

// Claude prints this when a resumed session is paused on a deferred tool and can't continue on
// its own — the fix is literally to send any prompt. We surface a one-tap "continue" for it.
const RESUME_NEEDS_PROMPT = "Provide a prompt to continue the conversation";
function setNeedsPrompt(c: Conn, value: boolean) {
  const v = connView.get(c.key);
  if (v) v.needsPrompt = value;
}

// Claude Code emits OSC 52 with an EMPTY selection (`ESC ] 52 ; ; <base64>`), which
// the addon's default provider silently drops (it only writes for selection "c").
// Route the empty (and "c") selection to the system clipboard so the auto-copy lands.
export const isSystemClipboard = (selection: string): boolean => selection === "" || selection === "c";
const clipboardProvider: IClipboardProvider = {
  // OSC 52 clipboard READ is disabled: letting a terminal program read the user's
  // clipboard (`ESC ] 52 ; <sel> ; ?`) is an exfiltration vector, and nothing here
  // needs it (paste uses the browser's native Cmd+V). This is write-only.
  readText() {
    return "";
  },
  async writeText(selection, text) {
    if (!isSystemClipboard(selection)) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard blocked (no focus / permission) — best effort
    }
  },
};

// Which OSC 8 hyperlink targets we open on click. Restricted to http(s) so a program can't
// emit a `javascript:`/`file:` link that runs on click — the safeguard xterm's docs call for.
export const isOpenableTerminalLink = (uri: string): boolean => /^https?:\/\//i.test(uri);

// Keep a drag as a text selection: refuse the mouse-tracking modes an app would use to take it
// over, so its coordinate reports never land in the agent's prompt (#729). Registered per
// terminal and disposed with it.
//
// SET only. The matching reset (`CSI ? … l`) is deliberately left alone: dropping it gains
// nothing (it disables what was never enabled) but would strand mouse mode ON for good in the
// one case that gets past this hook — a sequence mixing tracking with an unrelated mode, which
// is honoured on purpose. Letting every reset through keeps that recoverable.
//
// What was swallowed is still remembered: in the alternate buffer, xterm's fallback would turn
// the wheel into arrow keys — which a TUI binds to input history, so scrolling spun the prompt
// history (#737). When the app asked for wheel tracking, the wheel handler synthesizes the SGR
// report it asked for instead; `term.input` routes it through onData to the PTY like any
// keystroke. The cell coordinate is fixed at 1;1 — a transcript scroll doesn't depend on where
// the pointer sits, and the real position isn't exposed at this layer.
//
// The record is owned by the connection, not this closure, because it is per SESSION: connect()
// clears it alongside term.reset() so a crashed app's modes can't outlive it.
function guardMouseTracking(term: Terminal, swallowedMouseModes: Set<number>): void {
  term.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
    const swallowed = swallowsMouseTracking(params);
    if (swallowed) recordSwallowedModes(swallowedMouseModes, params);
    return swallowed;
  });
  term.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
    clearResetModes(swallowedMouseModes, params);
    return false;
  });
  term.attachCustomWheelEventHandler((ev) => {
    if (term.buffer.active.type !== "alternate" || !wantsWheelReports(swallowedMouseModes)) return true;
    const seq = wheelReportSequence(ev.deltaY, 1, 1);
    if (!seq) return true;
    term.input(seq, false);
    ev.preventDefault();
    return false;
  });
}

// The touch counterpart of the custom wheel handler above: a phone has no wheel, so when the
// swallowed alt-buffer app asked for wheel tracking (Claude's transcript), a one-finger
// vertical drag on the terminal is converted into the same SGR wheel reports — one per line
// height of movement, remainder carried (TouchScrollTracker). Outside that case the touch is
// left alone: the normal buffer keeps xterm's own gesture scrolling of the scrollback.
// preventDefault only fires while reports are being synthesized, so a plain tap still
// focuses the terminal and raises the soft keyboard.
function wireTouchScroll(term: Terminal, host: HTMLDivElement, swallowedMouseModes: Set<number>): void {
  const tracker = new TouchScrollTracker();
  const converting = () => term.buffer.active.type === "alternate" && wantsWheelReports(swallowedMouseModes);
  // The rendered line height, read per event — the font size is fixed but the element only
  // exists after open(), and a resize refits rows.
  const linePx = () => (term.element && term.rows > 0 ? Math.max(8, term.element.clientHeight / term.rows) : 16);
  host.addEventListener(
    "touchstart",
    (ev) => {
      if (converting() && ev.touches.length === 1) tracker.start(ev.touches[0].clientY);
      else tracker.end(); // a second finger (pinch) hands the gesture back to the browser
    },
    { passive: true },
  );
  host.addEventListener(
    "touchmove",
    (ev) => {
      if (!converting() || ev.touches.length !== 1) return tracker.end();
      const steps = tracker.move(ev.touches[0].clientY, linePx());
      for (let i = Math.abs(steps); i > 0; i--) {
        const seq = wheelReportSequence(steps, 1, 1);
        if (seq) term.input(seq, false);
      }
      ev.preventDefault(); // the app consumes the drag — don't also rubber-band the page
    },
    { passive: false },
  );
  const stop = () => tracker.end();
  host.addEventListener("touchend", stop);
  host.addEventListener("touchcancel", stop);
}

// Terminal input -> the slot's CURRENT socket (survives reconnects: `c.ws` is re-read
// each keystroke, so input always targets the live socket). The Enter-family key handler
// rides the same socket: keys whose bytes differ from xterm's native \r (per the user's
// Claude-scoped `terminalSubmit` mapping) are sent by us and the default \r suppressed.
function wireTerminalInput(term: Terminal, c: Conn): void {
  const send = (data: string): void => {
    if (c.ws && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "input", data }));
  };
  term.onData(send);
  term.attachCustomKeyEventHandler(makeEnterHandler(() => effectiveSubmitMode(c), send));
}

// Linkify file paths in the output → open them in a new tab via the raw-file route,
// scoped to the session's live cwd (read lazily, since it's learned after connect).
function registerFilePathLinks(term: Terminal, c: Conn): void {
  term.registerLinkProvider(
    createFilePathLinkProvider(
      term,
      () => c.knownCwd,
      (url) => window.open(url, "_blank", "noopener,noreferrer"),
    ),
  );
}

function ensure(key: string, target: ConnTarget): Conn {
  const existing = conns.get(key);
  if (existing) {
    existing.target = target;
    return existing;
  }
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', monospace",
    // Treat macOS Option as Meta so Claude's Alt bindings reach the PTY — Alt+Enter
    // (newline), Alt+B/F (word nav), Alt+Backspace (delete word). The cost is Option
    // dead-key accent entry (é etc.), which a coding terminal doesn't need.
    macOptionIsMeta: true,
    // The escape hatch for any mouse mode that still slips through the parser hooks below: on
    // macOS xterm only bypasses tracking for Option+drag, and ONLY when this is on (elsewhere it
    // is Shift+drag, which needs no option). Without it a Mac has no way to select at all (#729).
    macOptionClickForcesSelection: true,
    // `term.parser` is proposed API and THROWS without this, so the hooks below would take the
    // terminal down at construction rather than degrade.
    allowProposedApi: true,
    // OSC 8 hyperlinks in terminal output (e.g. Claude Code's statusline "PR #123"). Without a
    // handler, xterm falls back to a confirm() dialog with a strongly-worded warning on every
    // click — which reads as "the link is broken". Open http(s) targets in a new tab instead.
    linkHandler: {
      activate: (_event, uri) => {
        if (isOpenableTerminalLink(uri)) window.open(uri, "_blank", "noopener,noreferrer");
      },
    },
  });
  const swallowedMouseModes = new Set<number>();
  guardMouseTracking(term, swallowedMouseModes);
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  // OSC 52 clipboard: Claude Code auto-copies the selection via OSC 52 — without this
  // addon xterm ignores it, so the copy silently never reaches the browser clipboard.
  term.loadAddon(new ClipboardAddon(undefined, clipboardProvider));
  const host = document.createElement("div");
  host.style.width = "100%";
  host.style.height = "100%";
  wireTouchScroll(term, host, swallowedMouseModes);
  term.open(host);
  // Render each glyph in its own cell (canvas) instead of the default DOM renderer, which flows text
  // as inline runs: a full-width CJK glyph that isn't exactly 2× the Latin cell lets a long Japanese
  // line drift right and spill its tail past the terminal's edge (the reason this was added, b12cc48).
  // A fixed-grid renderer makes that structurally impossible.
  //
  // CAVEAT — version mismatch: @xterm/addon-canvas is xterm-5 era (its peerDependency is
  // `@xterm/xterm@^5`, and there is no stable xterm-6 build — even 0.8.0-beta still peers ^5), but the
  // app runs @xterm/xterm@6. It renders, but this xterm-5 renderer on xterm-6 internals is the
  // suspected cause of broken selection auto-scroll + scrollbar (#782) and OSC 8 link click (#783),
  // all of which regressed when this was introduced. Don't just bump the addon; the real fix is a
  // renderer decision — WebGL keeps the fixed grid (so the CJK drift above stays fixed), the DOM
  // renderer drops the dependency but risks that drift. Read #782 before touching this.
  // Best-effort: if the canvas renderer can't initialise, xterm keeps the DOM renderer.
  try {
    term.loadAddon(new CanvasAddon());
  } catch (err) {
    console.warn("[terminal] canvas renderer unavailable — falling back to the DOM renderer", err);
  }

  const c: Conn = {
    key,
    term,
    fitAddon,
    host,
    ws: null,
    knownSessionId: target.sessionId,
    knownCwd: null,
    target,
    handlers: {},
    sawExit: false,
    released: false,
    reconnectAttempts: 0,
    reconnectTimer: null,
    attachedEl: null,
    swallowedMouseModes,
  };
  conns.set(key, c);
  connView.set(key, { status: "connecting", serverCwd: target.cwd });
  registerFilePathLinks(term, c);
  wireTerminalInput(term, c);
  return c;
}

function scheduleReconnect(c: Conn) {
  if (!shouldReconnect({ released: c.released, sawExit: c.sawExit, reconnectPending: c.reconnectTimer !== null, isCommand: !!c.target.command })) return;
  const delay = reconnectDelayMs(c.reconnectAttempts);
  c.reconnectAttempts++;
  c.reconnectTimer = setTimeout(() => {
    c.reconnectTimer = null;
    if (!c.released) connect(c);
  }, delay);
}

function connect(c: Conn) {
  if (c.released) return;
  if (c.reconnectTimer) {
    clearTimeout(c.reconnectTimer);
    c.reconnectTimer = null;
  }
  // Neutralise the old socket's late events via the `sock !== c.ws` guards below.
  if (c.ws) c.ws.close();
  c.term.reset();
  // The mouse modes belonged to the session being replaced. Keeping them would make the next
  // app inherit "wants wheel reports" it never asked for, and its wheel would deliver escape
  // bytes instead of scrolling (#737).
  c.swallowedMouseModes.clear();
  c.sawExit = false;
  setStatus(c, "connecting");
  // Drop the previous session's resolved cwd so the Run menu can't list/launch the
  // prior project's scripts before the new `session` message arrives; clear any stale
  // resume-needs-prompt banner from the previous attempt.
  const v = connView.get(c.key);
  if (v) {
    v.serverCwd = c.target.cwd;
    v.needsPrompt = false;
  }

  // Resume the known id (server-learned, or the prop) so a reconnect re-attaches the
  // same session instead of spawning a fresh one each retry.
  const resumeId = c.knownSessionId ?? c.target.sessionId;
  const secure = location.protocol === "https:";
  const url = connWsUrl(c.target, resumeId, location.host, secure);
  const sock = new WebSocket(url);
  c.ws = sock;

  sock.onopen = () => {
    if (sock !== c.ws) return;
    c.reconnectAttempts = 0;
    setStatus(c, "connected");
    sock.send(JSON.stringify({ type: "resize", cols: c.term.cols, rows: c.term.rows }));
  };
  sock.onmessage = (event) => {
    if (sock !== c.ws) return;
    handleMessage(c, event);
  };
  sock.onclose = () => {
    if (sock !== c.ws) return;
    // The superseded banner already set the durable "superseded" state (another window holds
    // it); the close that follows must not downgrade it to a plain "disconnected", or the
    // Reconnect affordance keyed on it would vanish. scheduleReconnect no-ops here (sawExit).
    if (connView.get(c.key)?.status !== "superseded") setStatus(c, "disconnected");
    scheduleReconnect(c);
  };
  sock.onerror = () => {
    if (sock !== c.ws) return;
    setStatus(c, "disconnected");
  };
}

// A terminal-end frame (exit / superseded / error): apply its banner + status and stop
// auto-reconnect (sawExit). superseded stays reconnectable — the session is alive in another
// window — so it gets its own status; the rest are plain disconnects.
function applyTerminalEnd(c: Conn, msg: ParsedServerMessage): void {
  const effect = messageEffect(msg.type, !!c.target.command, msg.message);
  if (!effect.terminal) return;
  c.sawExit = true;
  if (effect.banner) c.term.write(effect.banner);
  setStatus(c, msg.type === "superseded" ? "superseded" : "disconnected");
  if (effect.callsOnExit) c.handlers.onExit?.();
}

function handleMessage(c: Conn, event: MessageEvent) {
  const msg = JSON.parse(event.data);
  if (msg.type === "output") {
    c.term.write(msg.data);
    // A resumed session paused on a deferred tool prints RESUME_NEEDS_PROMPT and waits — flag it
    // so the view can offer a one-tap "continue" (the marker text survives xterm's ANSI framing).
    if (typeof msg.data === "string" && msg.data.includes(RESUME_NEEDS_PROMPT)) setNeedsPrompt(c, true);
  } else if (msg.type === "session") {
    // Server reports the live session id — remember it so a later reconnect resumes
    // THIS session (esp. brand-new sessions that had no id yet) and the effective cwd.
    c.knownSessionId = msg.id;
    c.handlers.onSession?.(msg.id);
    if (typeof msg.cwd === "string") {
      c.knownCwd = msg.cwd;
      const v = connView.get(c.key);
      if (v) v.serverCwd = msg.cwd;
      c.handlers.onCwd?.(msg.cwd);
    }
  } else {
    applyTerminalEnd(c, msg);
  }
}

// Mount a view onto a slot: create the runtime on first acquire (and connect),
// otherwise reattach the persisted xterm to the new DOM host. Never reconnects an
// already-live slot — that's the whole point (no cold resume on remount).
export function attach(key: string, target: ConnTarget, handlers: ConnHandlers, el: HTMLElement, theme?: ITheme) {
  const created = !conns.has(key);
  const c = ensure(key, target);
  c.released = false;
  c.handlers = handlers;
  c.attachedEl = el;
  // Replay server-learned session/cwd to the freshly-bound handlers. Without this,
  // a slot that learned its id/cwd WHILE DETACHED (handlers were cleared) would
  // never forward them, leaving the parent persisted as `session: null` and the
  // session unrestorable on reload. Only the new-vs-known case actually fires a
  // useful update; the parent's setters are idempotent for already-known values.
  if (c.knownSessionId) handlers.onSession?.(c.knownSessionId);
  if (c.knownCwd) handlers.onCwd?.(c.knownCwd);
  el.appendChild(c.host);
  if (theme) c.term.options.theme = theme;
  if (created) connect(c);
  fitAndSyncSize(c);
  c.term.focus();
  // The persisted xterm was just re-parented into a new host. The sync fit() above can no-op (same size)
  // or run before layout, leaving the canvas renderer blank until a scroll. Re-fit + force a repaint next
  // frame, once the host is laid out. Guarded so a slot that detached/re-attached meanwhile is left alone.
  requestAnimationFrame(() => {
    if (c.attachedEl === el) fit(key);
  });
}

// Unmount a view but KEEP the slot alive (socket stays open, PTY stays alive). The
// xterm's host is re-parented out of the DOM; the buffer/scrollback are preserved.
export function detach(key: string, el: HTMLElement | null) {
  const c = conns.get(key);
  if (!c) return;
  if (el && c.attachedEl !== el) return; // a newer attach already took over this slot
  c.handlers = {};
  if (c.host.parentElement) c.host.remove();
  c.attachedEl = null;
}

// Take a stopped slot back: re-open its socket at the SAME target, which reattaches the live
// session (and supersedes whatever window holds it now). Only acts on a slot that stopped on a
// terminal message (sawExit) — a live or auto-retrying one is left alone. connect() clears
// sawExit and closes the old (already-closed) socket itself.
export function reconnect(key: string) {
  const c = conns.get(key);
  if (!c || !c.sawExit) return;
  c.reconnectAttempts = 0;
  connect(c);
}

// connectKey changed (session switch / relaunch in the same slot): point the slot
// at the new target and reconnect. Closes the previous socket, so the previous
// session falls back to the server's reap grace.
export function retarget(key: string, target: ConnTarget) {
  const c = conns.get(key);
  if (!c) return;
  c.target = target;
  c.knownSessionId = target.sessionId;
  c.knownCwd = null;
  c.reconnectAttempts = 0;
  c.sawExit = false;
  c.released = false;
  connect(c);
}

// Permanently tear the slot down (close socket, dispose xterm). Used for ephemeral
// (command) slots on unmount, and as the back end of terminate().
export function release(key: string) {
  const c = conns.get(key);
  if (!c) return;
  c.released = true;
  if (c.reconnectTimer) {
    clearTimeout(c.reconnectTimer);
    c.reconnectTimer = null;
  }
  try {
    c.ws?.close();
  } catch {
    // already closing
  }
  c.ws = null;
  try {
    c.host.remove();
  } catch {
    // not in the DOM
  }
  try {
    c.term.dispose();
  } catch {
    // already disposed
  }
  conns.delete(key);
  connView.delete(key);
}

// Explicit close (the cell's ✕): tell the server to reap this session NOW instead
// of holding it through the disconnect grace window, then tear the slot down.
export function terminate(key: string) {
  const c = conns.get(key);
  if (!c) return;
  c.sawExit = true;
  if (c.ws?.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "terminate" }));
  release(key);
}

// Submit a GUI-originated message into the PTY (text + a SEPARATE delayed submit — a
// same-burst text+submit reads as a paste in Claude's TUI). The submit byte follows the
// connection's `terminalSubmit` mapping (ESC+CR for a Claude cell in esc-cr mode), so a GUI
// send commits the same way the keyboard does. Both writes pin to the socket captured now;
// if the slot reconnects before the submit fires we skip it rather than submit a stray turn.
// Returns whether the text was delivered.
export function submitText(key: string, text: string): boolean {
  const c = conns.get(key);
  if (!c) return false;
  const sock = c.ws;
  if (!sock || sock.readyState !== WebSocket.OPEN) return false;
  setNeedsPrompt(c, false); // a prompt is on its way — clear the resume-stuck banner
  const submit = submitBytesFor(c);
  sock.send(JSON.stringify({ type: "input", data: text }));
  setTimeout(() => {
    if (c.ws === sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ type: "input", data: submit }));
    }
  }, 60);
  return true;
}

// Insert a MULTI-LINE block at the cursor, wrapped as a bracketed paste. Without the
// wrapper each newline in the block reads as Enter and the agent submits a fragment per
// line; inside it, the TUI takes the whole thing as one edit. No trailing CR — the user
// reads what arrived and sends it themselves. The text must already be free of control
// bytes (the server sanitizes it), or it could close the paste early.
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
export function pasteText(key: string, text: string): boolean {
  const c = conns.get(key);
  if (!text || c?.ws?.readyState !== WebSocket.OPEN) return false;
  c.ws.send(JSON.stringify({ type: "input", data: `${PASTE_START}${text}${PASTE_END}` }));
  c.term.focus();
  return true;
}

// Paste a MULTI-LINE block and submit it. Two separate writes: same-burst text+CR reads
// as a paste in claude's TUI and the CR is swallowed, and a CR glued onto a bracketed
// paste can arrive before the paste has been committed to the input box. Both writes pin
// to the socket captured now, so a slot that reconnects mid-flight never gets a stray CR
// that would submit whatever the user had typed there instead.
const PASTE_SUBMIT_MS = 200;
export function pasteAndSubmit(key: string, text: string): boolean {
  const c = conns.get(key);
  const sock = c?.ws;
  if (!text || !c || !sock || sock.readyState !== WebSocket.OPEN) return false;
  const submit = submitBytesFor(c);
  sock.send(JSON.stringify({ type: "input", data: `${PASTE_START}${text}${PASTE_END}` }));
  setTimeout(() => {
    if (c.ws === sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: "input", data: submit }));
  }, PASTE_SUBMIT_MS);
  return true;
}

// The slots whose conversation another cell can read. A snapshot, not a reactive view:
// the caller is a menu that opens, gets picked from, and closes. What counts as
// readable lives in readableSlot — this only flattens each Conn for it to judge.
const slotCandidate = (c: Conn): SlotCandidate => ({
  key: c.key,
  connected: c.ws?.readyState === WebSocket.OPEN,
  isCommand: c.target.command !== null,
  isShellLauncher: !!c.target.launcher && "shell" in c.target.launcher,
  sessionId: c.knownSessionId,
  cwd: c.knownCwd ?? c.target.cwd,
  codex: !!c.target.codex,
});

export function listSlots(): SlotInfo[] {
  return [...conns.values()].map(slotCandidate).flatMap((candidate) => readableSlot(candidate) ?? []);
}

// Insert text (a path, or space-joined paths) at the cursor via the normal input
// channel — no trailing CR, so the user reviews and submits.
export function insertText(key: string, text: string) {
  if (!text) return;
  const c = conns.get(key);
  if (!c) return;
  if (c.ws?.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "input", data: text }));
  c.term.focus();
}

// Send a raw key sequence (Tab, Esc, Ctrl-C…) straight to the PTY — for the on-screen key bar,
// which has no physical keyboard for these. No submit; no focus change, so tapping a key doesn't
// dismiss/re-open the mobile keyboard.
export function sendKey(key: string, data: string): void {
  const c = conns.get(key);
  if (c?.ws?.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "input", data }));
}

// Arrow keys are mode-sensitive: a TUI in application-cursor-keys mode (DECCKM — Claude Code's
// TUI, vim, less…) expects ESC O A, while a normal shell expects ESC [ A. xterm tracks the
// current mode, so read it and send the right form — a fixed sequence works in only one mode
// and looks dead (or echoes ^[[A) in the other. This is what xterm itself does for a real arrow.
export type ArrowDir = "up" | "down" | "right" | "left";
const ARROW_FINAL: Record<ArrowDir, string> = { up: "A", down: "B", right: "C", left: "D" };
// ESC O x in application-cursor-keys mode, ESC [ x otherwise. Pure so the mode split is tested
// without standing up a terminal.
export function arrowSequence(dir: ArrowDir, appMode: boolean): string {
  return (appMode ? "\x1bO" : "\x1b[") + ARROW_FINAL[dir];
}
export function sendArrow(key: string, dir: ArrowDir): void {
  const c = conns.get(key);
  if (c?.ws?.readyState !== WebSocket.OPEN) return;
  c.ws.send(JSON.stringify({ type: "input", data: arrowSequence(dir, c.term.modes.applicationCursorKeysMode) }));
}

// The session this slot is currently connected as (server-learned, or the target's). Lets a
// view tell a real session SWITCH (retarget) apart from the slot merely learning its own
// freshly-minted id (null → X via the `session` message), which must NOT reconnect.
export function slotSessionId(key: string): string | null {
  const c = conns.get(key);
  return c ? (c.knownSessionId ?? c.target.sessionId) : null;
}

export function focus(key: string) {
  conns.get(key)?.term.focus();
}

// Tell the server whether this slot is the user's actively-viewed pane (a grid cell
// zoomed to fill, vs. one tile among many). An active pane suppresses its attention
// flag and marks it read; an inactive grid cell can surface blocked/done while
// unfocused. No-op if the socket isn't open — Terminal.vue re-sends on (re)connect.
export function sendView(key: string, active: boolean) {
  const c = conns.get(key);
  if (c?.ws?.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "view", active }));
}

// Read a slot's xterm buffer (scrollback + viewport) as plain text — used to hand a
// command cell's captured output to the AI summariser. Each line is trailing-trimmed
// by translateToString; trailing blank lines are dropped. "" for an unknown slot.
export function readBuffer(key: string): string {
  const c = conns.get(key);
  if (!c) return "";
  const buf = c.term.buffer.active;
  const lines = Array.from({ length: buf.length }, (_, i) => buf.getLine(i)?.translateToString(true) ?? "");
  return lines.join("\n").trimEnd();
}

// Refit to the current host size and push the new dimensions to the PTY.
export function fit(key: string) {
  const c = conns.get(key);
  if (!c || !c.attachedEl) return;
  fitAndSyncSize(c);
  // Force the canvas renderer to repaint. `fit()` only redraws when cols/rows actually change, so a
  // re-parent / KeepAlive reactivation with the SAME size (attach, onActivated) would otherwise leave
  // the viewport blank until a scroll. The buffer is intact — this just repaints it.
  if (c.term.rows > 0) c.term.refresh(0, c.term.rows - 1);
}

export function setTheme(key: string, theme: ITheme) {
  const c = conns.get(key);
  if (c) c.term.options.theme = theme;
}
