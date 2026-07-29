import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TerminalView from "../../../src/components/Terminal.vue";
import { useMobileKeys } from "../../../src/composables/useMobileKeys";

// The key bar is gated by the app-wide (persisted) toggle, not raw touch detection — so drive
// that ref directly rather than faking matchMedia.
const setKeys = (on: boolean) => {
  useMobileKeys().value = on;
};

// A WebSocket double whose sent frames we can read, treated as open immediately.
class FakeWS {
  static readonly OPEN = 1;
  static readonly instances: FakeWS[] = [];
  readyState = 1;
  url: string;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {}
}

const coarse = (matches: boolean) =>
  ((q: string) => ({
    matches,
    media: q,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

const props = (over: Record<string, unknown> = {}) => ({ sessionId: "s", connectKey: 0, persistKey: "cell-7", devTerminal: false, ...over });

describe("Terminal.vue — mobile input aids", () => {
  beforeEach(() => {
    FakeWS.instances.length = 0;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    globalThis.WebSocket = FakeWS as unknown as typeof WebSocket;
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    window.matchMedia = coarse(false); // xterm's browser service calls matchMedia on init
  });
  afterEach(() => {
    // release the durable slot so it can't leak into the next mount
    void import("../../../src/composables/useTerminalConnections").then((m) => m.release("cell-7"));
  });

  it("shows the key row + text field when the toggle is on, hidden when off", async () => {
    setKeys(false);
    const off = mount(TerminalView, { props: props() });
    await flushPromises();
    expect(off.find('[data-testid="term-key-row"]').exists()).toBe(false);
    expect(off.find('[data-testid="cell-mobile-input"]').exists()).toBe(false);

    setKeys(true);
    const on = mount(TerminalView, { props: props() });
    await flushPromises();
    expect(on.find('[data-testid="term-key-row"]').exists()).toBe(true);
    expect(on.find('[data-testid="cell-mobile-input"]').exists()).toBe(true);
  });

  it("the header ⌨ toggle flips the aids on and off", async () => {
    setKeys(false);
    window.matchMedia = coarse(false);
    const w = mount(TerminalView, { props: props() });
    await flushPromises();
    expect(w.find('[data-testid="term-key-row"]').exists()).toBe(false);
    // The toggle is offered even on a non-touch client (that's the whole point of a manual one).
    await w.find('[data-testid="term-keys-toggle"]').trigger("click");
    expect(w.find('[data-testid="term-key-row"]').exists()).toBe(true);
  });

  it("a grid thumbnail (devTerminal, not expanded) gets no aids or toggle; an expanded cell does", async () => {
    setKeys(true);
    const thumb = mount(TerminalView, { props: props({ devTerminal: true, expanded: false }) });
    await flushPromises();
    expect(thumb.find('[data-testid="term-key-row"]').exists()).toBe(false);
    expect(thumb.find('[data-testid="term-keys-toggle"]').exists()).toBe(false);

    const big = mount(TerminalView, { props: props({ devTerminal: true, expanded: true }) });
    await flushPromises();
    expect(big.find('[data-testid="term-key-row"]').exists()).toBe(true);
  });

  it("tapping a special key sends its raw sequence to the PTY", async () => {
    setKeys(true);
    const w = mount(TerminalView, { props: props() });
    await flushPromises();
    const sock = FakeWS.instances.at(-1);
    const before = sock?.sent.length ?? 0;
    // The up-arrow button (history recall) → ESC [ A.
    const upBtn = w.findAll('[data-testid="term-key-row"] button').find((b) => b.text() === "↑");
    expect(upBtn).toBeTruthy();
    await upBtn?.trigger("click");
    expect(sock?.sent.slice(before)).toContainEqual(JSON.stringify({ type: "input", data: "\x1b[A" }));
  });

  // Arrows are why the key bar cannot just send fixed bytes. A TUI in application-cursor-keys
  // mode (DECCKM — Claude Code's own TUI, vim, less) expects ESC O A where a shell expects
  // ESC [ A; send the wrong one and ↑ stops recalling history in exactly the app the bar exists
  // to drive. The mode is read off the live terminal, so this drives it through the socket the
  // way the PTY would.
  it("sends the arrow form the terminal's cursor-keys mode asks for", async () => {
    setKeys(true);
    const w = mount(TerminalView, { props: props() });
    await flushPromises();
    const ws = FakeWS.instances[0];

    const arrowUp = () => {
      const btn = w.findAll('[data-testid="term-key-row"] button').find((b) => b.text() === "↑");
      if (!btn) throw new Error("the key row has no ↑");
      return btn;
    };
    const lastSent = () => {
      const frame = ws.sent.at(-1);
      return frame ? (JSON.parse(frame) as { data: string }).data : null;
    };
    await arrowUp().trigger("click");
    expect(lastSent()).toBe("\x1b[A"); // normal mode

    ws.onmessage?.({ data: JSON.stringify({ type: "output", data: "\x1b[?1h" }) }); // the app sets DECCKM
    // xterm parses writes asynchronously, so retry the tap until the mode has landed.
    await vi.waitFor(async () => {
      await arrowUp().trigger("click");
      expect(lastSent()).toBe("\x1bOA"); // application mode
    });
  });

  it("shows a Continue banner when a resumed session prints the deferred-tool prompt, and one tap sends 'continue'", async () => {
    setKeys(false);
    const w = mount(TerminalView, { props: props({ sessionId: "sess-stuck" }) });
    await flushPromises();
    const sock = FakeWS.instances.at(-1);
    expect(w.find('[data-testid="term-needs-prompt"]').exists()).toBe(false);
    // Claude resumes onto a deferred tool and asks for a prompt (marker survives ANSI framing).
    sock?.onmessage?.({
      data: JSON.stringify({ type: "output", data: "\x1b[31mError: No deferred tool marker found. Provide a prompt to continue the conversation.\x1b[0m" }),
    });
    await flushPromises();
    expect(w.find('[data-testid="term-needs-prompt"]').exists()).toBe(true);

    const before = sock?.sent.length ?? 0;
    await w.find('[data-testid="term-continue"]').trigger("click");
    await flushPromises();
    expect(sock?.sent.slice(before)).toContainEqual(JSON.stringify({ type: "input", data: "continue" }));
    expect(w.find('[data-testid="term-needs-prompt"]').exists()).toBe(false); // cleared on send
  });

  // The other window may be a desktop the user cannot reach — from a phone, "open in another
  // window" without a way back is the session gone. Taking it back re-attaches HERE, which
  // supersedes the holder in turn.
  it("offers to take a superseded session back, and reconnects when tapped", async () => {
    setKeys(false);
    const w = mount(TerminalView, { props: props({ sessionId: "sess-elsewhere" }) });
    await flushPromises();
    expect(w.find('[data-testid="term-superseded"]').exists()).toBe(false);

    const socketCount = FakeWS.instances.length;
    FakeWS.instances.at(-1)?.onmessage?.({ data: JSON.stringify({ type: "superseded" }) });
    await flushPromises();
    expect(w.find('[data-testid="term-superseded"]').exists()).toBe(true);

    await w.find('[data-testid="term-reconnect"]').trigger("click");
    await flushPromises();
    expect(FakeWS.instances).toHaveLength(socketCount + 1); // a new socket, at the same target
    expect(FakeWS.instances.at(-1)?.url).toContain("sess-elsewhere");
    expect(w.find('[data-testid="term-superseded"]').exists()).toBe(false);
  });
});
