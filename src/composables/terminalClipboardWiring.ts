// Everything the terminal does with the CLIPBOARD, moved out of useTerminalConnections.ts when
// the 4.4.0 merge pushed that file past the 600-line limit. One concern, and a self-contained
// one: the OSC 52 provider the xterm addon is built with, the two routes a selection can reach
// the system clipboard by, and the settle timer that decides when copy-on-select fires. None of
// it knows about a Conn, a socket or the slot map.
//
// useTerminalConnections re-exports isSystemClipboard, which is where its spec reaches for it.
import type { Terminal } from "@xterm/xterm";
import type { IClipboardProvider } from "@xterm/addon-clipboard";
import { selectionToCopy } from "../../common/terminalClipboard";
import { isCopyOnSelectEnabled } from "./copyOnSelect";

// Claude Code emits OSC 52 with an EMPTY selection (`ESC ] 52 ; ; <base64>`), which
// the addon's default provider silently drops (it only writes for selection "c").
// Route the empty (and "c") selection to the system clipboard so the auto-copy lands.
export const isSystemClipboard = (selection: string): boolean => selection === "" || selection === "c";
export const clipboardProvider: IClipboardProvider = {
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

// Put the terminal's selection on the system clipboard, by whichever route the browser allows.
//
// `navigator.clipboard` is the direct one, but it is secure-context-only: at `http://<lan-ip>` it
// does not exist AT ALL, and reaching this app that way from a second machine is ordinary. The
// fallback hands the job back to xterm — with its helper textarea focused, `execCommand("copy")`
// fires xterm's own `copy` listener, which writes THE CURRENT SELECTION.
//
// Which is why this takes the terminal's host and not merely a string: it can only ever copy what
// the terminal has selected, and must not be generalised into "write this text to the clipboard".
async function writeTerminalSelection(host: HTMLDivElement, text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // document not focused, or permission refused — fall through instead of giving up
    }
  }
  // Focus is NOT taken here. Reaching this line means the user just dragged inside this terminal,
  // so xterm has already focused its textarea; if something else holds focus by now, stealing it
  // back would be worse than not copying.
  const textarea = host.querySelector(".xterm-helper-textarea");
  if (!textarea || document.activeElement !== textarea) return false;
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

// How long the selection must hold still before it is copied. xterm fires onSelectionChange on
// every coordinate change during a drag, so writing on each one would put every intermediate
// selection into the OS clipboard HISTORY (Win+V) — one drag, twenty entries. Restarting this
// timer on each event leaves only the last one.
//
// A pause longer than this MID-drag still writes what was selected so far, and then again at the
// end. That is the accepted cost of not keying this to mouseup: the settle timer serves a keyboard
// or select-all selection too, where there is no mouse event to key to. The clipboard still ends
// up holding the right text either way — only the history gets one extra entry.
const SELECTION_SETTLE_MS = 150;

// Copy-on-select (#900): a settled mouse selection reaches the clipboard with no key pressed. Off
// unless config.json asks for it; what gets skipped and why is in common/terminalClipboard.ts.
//
// This is the app's only clipboard write of its own. The `copy` keymap action looks like the same
// feature but isn't: there a keystroke had already made the browser copy, and xterm's own listener
// served it — nothing here had to write anything.
export function wireCopyOnSelect(term: Terminal, host: HTMLDivElement): void {
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCopied: string | null = null;
  // Writes run one after another rather than the moment each one is due. A settle can land while
  // the previous write is still pending — a browser that ASKS for clipboard permission leaves it
  // pending for as long as the user takes to answer — and two overlapping writes then resolve in
  // whichever order the browser picks, which can leave the clipboard holding the OLDER selection.
  let writes: Promise<void> = Promise.resolve();
  const copySettledSelection = async (): Promise<void> => {
    const text = selectionToCopy(isCopyOnSelectEnabled(), term.getSelection(), lastCopied);
    // Remembered only once it has actually landed, so a write blocked by a lost focus is retried
    // rather than treated as already done.
    if (text !== null && (await writeTerminalSelection(host, text))) lastCopied = text;
  };
  const enqueueCopy = (): void => {
    // The catch matters more than it looks: one rejected link would poison the chain and end
    // copy-on-select for this terminal for good, with nothing to show for it.
    writes = writes.then(copySettledSelection).catch(() => {});
  };
  term.onSelectionChange(() => {
    // The default path, and it must cost nothing: xterm fires this on every coordinate change, so
    // without the early return every ordinary drag would schedule and cancel a timer per cell
    // crossed for a feature nobody turned on.
    if (!isCopyOnSelectEnabled()) return;
    // A cleared selection retires the last one, so selecting the same text again afterwards copies
    // again: between two drags the user may well have put something else on the clipboard, and
    // "you already copied that" would then leave them with the wrong thing and no sign of it.
    //
    // Read per EVENT rather than at settle, because a click that clears and the drag that follows
    // can both land inside one settle window — by the time the timer runs, only the new selection
    // is visible and the clear would go unnoticed. hasSelection() is the cheap half of the API;
    // getSelection() rebuilds the text from the buffer, which is not worth doing per event.
    if (!term.hasSelection()) lastCopied = null;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(enqueueCopy, SELECTION_SETTLE_MS);
  });
}
