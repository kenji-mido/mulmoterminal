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

  // The grid-collision fix: live-sync can reassign a cell to another session by changing only
  // the sessionId prop (no connectKey tick). The slot must follow, or two cells fight over one.
  it("retargets to a different session when only the sessionId prop changes", async () => {
    setKeys(false);
    const w = mount(TerminalView, { props: props({ sessionId: "sess-A" }) });
    await flushPromises();
    const before = FakeWS.instances.length;
    await w.setProps({ sessionId: "sess-B" });
    await flushPromises();
    expect(FakeWS.instances.length).toBeGreaterThan(before); // a fresh socket opened
    expect(FakeWS.instances.at(-1)?.url).toContain("session=sess-B");
  });

  it("does NOT retarget when the sessionId is CLEARED to null (the open chat session was hidden/deleted)", async () => {
    setKeys(false);
    const w = mount(TerminalView, { props: props({ sessionId: "sess-gone" }) });
    await flushPromises();
    const before = FakeWS.instances.length;
    // App.vue clears activeId after a hide/delete — no connectKey tick. Reconnecting
    // session-less here would silently spawn a fresh session nobody asked for.
    await w.setProps({ sessionId: null });
    await flushPromises();
    expect(FakeWS.instances).toHaveLength(before); // no new socket
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

  it("does NOT retarget when the slot merely learns its own freshly-minted id (null → id)", async () => {
    setKeys(false);
    const w = mount(TerminalView, { props: props({ sessionId: null }) });
    await flushPromises();
    // Server reports the minted id → the slot is now connected AS mint-X.
    FakeWS.instances.at(-1)?.onmessage?.({ data: JSON.stringify({ type: "session", id: "mint-X", cwd: "/c" }) });
    await flushPromises();
    const before = FakeWS.instances.length;
    // The parent adopts that same id into the prop — reconnecting here would be wrong.
    await w.setProps({ sessionId: "mint-X" });
    await flushPromises();
    expect(FakeWS.instances).toHaveLength(before); // no new socket
  });
});
