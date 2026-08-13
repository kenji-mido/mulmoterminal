// The headless doubles every useTerminalConnections spec needs: an xterm `Terminal` that records
// what the manager did to it, the three addons it loads, and a WebSocket the test drives by hand.
//
// Shared because the alternative was worse. The scaffolding is ~130 lines, so a spec that split
// off to respect the 600-line ceiling had to copy all of it — and the file kept growing instead
// (#1166). Note this is NOT a global mock: mouseTrackingGuard.spec drives a REAL terminal, so the
// doubles have to stay opt-in per file.
//
// HOW TO USE IT (the shape is dictated by hoisting, not by taste):
//
//   const { termState, keyState } = await vi.hoisted(async () => (await import("../../helpers/xtermDouble")).createXtermState());
//   vi.mock("@xterm/xterm", async () => (await import("../../helpers/xtermDouble")).xtermModule(termState, keyState));
//   vi.mock("@xterm/addon-fit", async () => (await import("../../helpers/xtermDouble")).fitAddonModule());
//   ...
//
// `vi.mock` factories run before the file's own imports, so they cannot close over one — hence
// the `await import` inside each factory, and hence the state being built by `vi.hoisted` rather
// than by a plain `const`.

export interface FakeWheelEvent {
  deltaY: number;
  preventDefault: () => void;
}

// The key handler ensure() registers, captured so a test can drive it and assert the real wiring
// (send + suppress-default). Defaults to a pass-through returning true, so a test that forgot to
// attach sees the untouched behaviour — and thus fails its assertion — rather than crashing.
export interface XtermKeyState {
  handler: (e: unknown) => boolean;
}

export interface XtermTermState {
  /** The options ensure() passed to `new Terminal({...})`, captured for assertions. */
  options: Record<string, unknown>;
  csiHandlers: unknown[][];
  wheelHandler: (ev: FakeWheelEvent) => boolean;
  input: string[];
  bufferType: "normal" | "alternate";
  hasSelection: boolean;
  selection: string;
  onSelectionChange: () => void;
  helperTextarea: HTMLTextAreaElement | null;
  /** What xterm hands the manager for every chunk on its way to the PTY — keystrokes AND the
   *  pointer reports the app feeds back through `term.input()`. Captured so a test can push
   *  either kind through the real `send` and see which one counts as the user typing (#992). */
  emitData: (data: string) => void;
}

export function createXtermState(): { termState: XtermTermState; keyState: XtermKeyState } {
  return {
    termState: {
      options: {},
      csiHandlers: [],
      wheelHandler: () => true,
      input: [],
      bufferType: "normal",
      hasSelection: false,
      selection: "",
      onSelectionChange: () => {},
      helperTextarea: null,
      emitData: () => {},
    },
    keyState: { handler: () => true },
  };
}

export function xtermModule(termState: XtermTermState, keyState: XtermKeyState) {
  return {
    Terminal: class {
      options: Record<string, unknown> = {};
      cols = 80;
      rows = 24;
      constructor(opts: Record<string, unknown>) {
        // The SAME object, not a copy: setFont/setTheme mutate `term.options` after construction,
        // and a test that only saw the constructor argument could not tell whether they landed.
        this.options = opts;
        termState.options = opts;
      }
      // ensure() registers the mouse-tracking guards through this (#729); the guards' own behaviour
      // is covered against a REAL terminal in mouseTrackingGuard.spec.ts.
      parser = { registerCsiHandler: (...args: unknown[]) => termState.csiHandlers.push(args) };
      loadAddon() {}
      registerLinkProvider() {}
      // Real xterm puts a hidden helper textarea inside the host, and the clipboard fallback finds
      // the copy target through it — a double that skipped it would let that path "pass" untested.
      open(host: HTMLElement) {
        const textarea = document.createElement("textarea");
        textarea.className = "xterm-helper-textarea";
        host.appendChild(textarea);
        termState.helperTextarea = textarea;
      }
      onData(fn: (data: string) => void) {
        termState.emitData = fn;
      }
      attachCustomKeyEventHandler(fn: (e: unknown) => boolean) {
        keyState.handler = fn;
      }
      // The wheel guard (#737) is driven directly by the stale-mode test.
      attachCustomWheelEventHandler(fn: (ev: FakeWheelEvent) => boolean) {
        termState.wheelHandler = fn;
      }
      get buffer() {
        return { active: { type: termState.bufferType } };
      }
      // The clipboard decision asks the terminal whether anything is selected (#900), so the
      // double has to answer. Selection-specific behaviour is covered in terminalClipboard.spec.
      hasSelection() {
        return termState.hasSelection;
      }
      // Copy-on-select rides this pair (#900): xterm reports that the selection moved, and the
      // manager reads what it now is.
      onSelectionChange(fn: () => void) {
        termState.onSelectionChange = fn;
      }
      getSelection() {
        return termState.selection;
      }
      input(data: string) {
        termState.input.push(data);
      }
      write() {}
      refresh() {}
      reset() {}
      focus() {}
      scrollToBottom() {}
      dispose() {}
    },
  };
}

export const fitAddonModule = () => ({
  FitAddon: class {
    fit() {}
  },
});

export const webLinksAddonModule = () => ({
  WebLinksAddon: class {
    activate() {}
  },
});

export const clipboardAddonModule = () => ({
  ClipboardAddon: class {
    activate() {}
  },
});

// A WebSocket double the test drives by hand (fire onopen / onmessage when it wants).
//
// `instances` is static and therefore shared for the module's lifetime — each spec clears it in
// `beforeEach`, the way the original did.
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];
  url: string;
  readyState = FakeWebSocket.OPEN; // treat as open immediately for send() guards
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }
}
