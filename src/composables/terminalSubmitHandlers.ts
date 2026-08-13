// The two handlers that turn a keystroke into BYTES on the pty, lifted out of
// useTerminalConnections.ts when merging upstream 3.0.0 pushed that file past the 600-line limit.
// They belong together and they belong out here: neither one touches a Conn, a socket or the slot
// map — given a getter and a `send`, each is a pure decision about one key event. Their tests
// already live apart, in test/src/composables/terminalConnectionsSubmit.spec.ts.
//
// useTerminalConnections re-exports both, so every caller still reaches them where it always did.
import { enterKeyOverride, type EnterKeyEvent, type TerminalSubmitMode } from "../../common/terminalSubmit";
import { sendBytesFor, type Keymap, type KeymapKeyEvent } from "../../common/keymap";

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

// The user's `keymap.send` bindings, turned into bytes on this terminal's PTY (#1005) — the
// same three lines as the Enter handler above, and `preventDefault()` matters here for the same
// reason: without it xterm leaves the browser to fire a keypress that arrives as stray input.
//
// Per terminal rather than on the grid's handler, because the bytes go to ONE pty — the one
// whose xterm saw the key — and the grid has no such subject when nothing is enlarged.
type SendHandlerEvent = KeymapKeyEvent & { type: string; isComposing?: boolean; preventDefault: () => void };
export function makeSendHandler(getKeymap: () => Keymap, send: (data: string) => void): (e: SendHandlerEvent) => boolean {
  return (e) => {
    const bytes = sendBytesFor(getKeymap(), e);
    if (bytes === null) return true;
    e.preventDefault();
    send(bytes);
    return false;
  };
}
