// The two key handlers that turn a keystroke into BYTES on a terminal's pty, and the one thing
// they share: `preventDefault()`. Without it xterm's `_keyDown` returns early on a false custom
// handler and the browser fires a follow-up keypress that `_keyPress` turns into a bare \r —
// submitting the prompt the handler was trying not to submit.
//
// Their own module because useTerminalConnections is at its line budget and these are the part of
// it with no dependency on a live connection: a mode getter, a keymap getter, and a send function.
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
