import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import type { TerminalFont } from "../../../src/composables/useTerminalConnections";
import { TERMINAL_FONT_FAMILY_DEFAULT } from "../../../common/terminalFontFamily";
import { TERMINAL_FONT_SIZE_DEFAULT } from "../../../common/terminalFontSize";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

// The seam under test. attach() takes the font the terminal is BUILT with; setFont() is the only
// path that changes it afterwards — and the only one that re-fits and tells the PTY.
const attached: TerminalFont[] = [];
const setFontCalls: TerminalFont[] = [];
const setThemeCalls: unknown[] = [];
vi.mock("../../../src/composables/useTerminalConnections", async () => {
  const { reactive } = await import("vue");
  return {
    connView: reactive(new Map()),
    attach: (_k: string, _t: unknown, _h: unknown, _el: unknown, _theme: unknown, font: TerminalFont) => attached.push(font),
    setFont: (_k: string, font: TerminalFont) => setFontCalls.push(font),
    setTheme: (_k: string, theme: unknown) => setThemeCalls.push(theme),
    detach: () => {},
    release: () => {},
    retarget: () => {},
    terminate: () => {},
    fit: () => {},
    focus: () => {},
    insertText: () => {},
    sendView: () => {},
    readBuffer: () => null,
    submitText: () => true,
    isClaudeTarget: () => false,
  };
});

// jsdom has no ResizeObserver and Terminal.vue constructs one on mount. The auto-fit it drives is
// not what these specs are about — the font seam is — so a no-op stub is enough.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Nothing is passed down any more: Terminal.vue resolves the directory's look from its own cwd
// (#909), so a spec drives it the way the real app does — by answering /api/dir-config.
function serveDirConfig(dirConfig: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async (url: string) => {
    if (String(url).includes("/api/dir-config")) return { ok: true, json: async () => dirConfig };
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  attached.length = 0;
  setFontCalls.length = 0;
  setThemeCalls.length = 0;
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
});

// At module scope, not inside a test: a component's module load is not the test's work, and
// billing it to `testTimeout` is what makes the first test of a file the one that flakes.
const Terminal = (await import("../../../src/components/Terminal.vue")).default;

async function mountTerminal(slot: string) {
  return mount(Terminal, { props: { sessionId: null, connectKey: 1, persistKey: slot, cwd: `/proj/${slot}` } });
}

describe("Terminal.vue resolves its directory's look from its own cwd", () => {
  // The load-bearing case, and the reason the props were removed. useDirConfig has nothing cached
  // on a fresh page load, so the terminal is BUILT with the app-wide font and the directory's
  // arrives only when /api/dir-config resolves. If this watcher does not fire, a dir-pinned font
  // never applies at all — indistinguishable, from the user's side, from the feature being broken.
  it("applies the directory's font once the config resolves, via setFont so it re-fits", async () => {
    serveDirConfig({ fontSize: 20, fontFamily: "Songti SC, monospace" });
    await mountTerminal("pinned");
    await flushPromises();

    expect(attached[0]).toEqual({ size: TERMINAL_FONT_SIZE_DEFAULT, family: TERMINAL_FONT_FAMILY_DEFAULT });
    expect(setFontCalls.at(-1)).toEqual({ size: 20, family: "Songti SC, monospace" });
  });

  it("applies the directory's palette the same way", async () => {
    serveDirConfig({ colors: { background: "#190a23" } });
    await mountTerminal("palette");
    await flushPromises();

    expect(setThemeCalls.at(-1)).toMatchObject({ background: "#190a23" });
  });

  // No `.mulmoterminal.json` is the overwhelmingly common case: it must leave the app-wide values
  // alone rather than push a redundant re-fit at every terminal on every load.
  it("leaves the app-wide font alone when the directory pins nothing", async () => {
    serveDirConfig({});
    await mountTerminal("plain");
    await flushPromises();

    expect(attached[0]).toEqual({ size: TERMINAL_FONT_SIZE_DEFAULT, family: TERMINAL_FONT_FAMILY_DEFAULT });
    expect(setFontCalls).toHaveLength(0);
  });

  // The parser is the trust boundary — the server validates, but an unusable stack would otherwise
  // reach the canvas renderer straight off the wire.
  it("ignores an unusable stack rather than passing it to the canvas", async () => {
    serveDirConfig({ fontFamily: "Cica; color: red" });
    await mountTerminal("garbage");
    await flushPromises();

    expect(setFontCalls).toHaveLength(0);
  });
});

// The single view leaves `cwd` unset on purpose — passing it would put `?cwd=` on the WebSocket
// and change what the server connects to — so it hands the directory in separately. Without this
// its palette would resolve only once the session reported back, i.e. a visible flash of the
// app-wide theme first, which is the regression this hint exists to prevent.
describe("Terminal.vue falls back to the dirCwd hint when it has no cwd", () => {
  it("resolves the directory's font from dirCwd alone", async () => {
    serveDirConfig({ fontSize: 18, fontFamily: "Cica, monospace" });
    const w = mount(Terminal, { props: { sessionId: null, connectKey: 1, persistKey: "hinted", dirCwd: "/proj/hinted" } });
    await flushPromises();

    expect(setFontCalls.at(-1)).toEqual({ size: 18, family: "Cica, monospace" });
    w.unmount();
  });
});
