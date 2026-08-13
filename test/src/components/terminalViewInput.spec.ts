// The wire between two halves that were each already covered and still left the middle untested:
// useTerminalConnections decides WHAT counts as the user typing, TerminalCell decides what to do
// about it, and this component is the only thing joining them. Deleting the join used to leave
// every one of the ~6.8k specs passing while a parked cell could never be woken again (#992).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import type { ConnHandlers } from "../../../src/composables/useTerminalConnections";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

const attachedHandlers: ConnHandlers[] = [];
vi.mock("../../../src/composables/useTerminalConnections", async () => {
  const { reactive } = await import("vue");
  return {
    connView: reactive(new Map()),
    attach: (_k: string, _t: unknown, handlers: ConnHandlers) => attachedHandlers.push(handlers),
    setFont: () => {},
    setTheme: () => {},
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

// jsdom has no ResizeObserver and Terminal.vue constructs one on mount.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// At module scope, not inside a test: a component's module load is not the test's work, and
// billing it to `testTimeout` is what makes the first test of a file the one that flakes.
const Terminal = (await import("../../../src/components/Terminal.vue")).default;

const mountTerminal = async () => {
  return mount(Terminal, { props: { sessionId: null, connectKey: 1, persistKey: "input-spec", cwd: "/proj/input-spec" } });
};

// The compiled SFC lists the names `defineEmits` declared. Read through a guard rather than a
// cast, since the component object is typed as a component and not as this shape.
const declaredEmits = (component: unknown): string[] => {
  if (component && typeof component === "object" && "emits" in component && Array.isArray(component.emits)) {
    return component.emits.filter((name): name is string => typeof name === "string");
  }
  return [];
};

beforeEach(() => {
  attachedHandlers.length = 0;
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
});

describe("Terminal.vue reports the user typing", () => {
  it("binds onInput when it attaches, so the connection has somewhere to report to", async () => {
    await mountTerminal();
    await flushPromises();
    expect(attachedHandlers[0]?.onInput).toBeTypeOf("function");
  });

  it("raises an `input` event when the connection reports one", async () => {
    const w = await mountTerminal();
    await flushPromises();
    attachedHandlers[0]?.onInput?.();
    expect(w.emitted("input")).toHaveLength(1);
  });

  // DECLARING `input` is load-bearing, not bookkeeping. xterm keeps a hidden <textarea> that
  // fires a NATIVE `input` event on every keystroke and all through IME composition, and it
  // bubbles to this component's root. A declared emit is excluded from fallthrough, so a parent's
  // `@input` binds to the component event alone. Drop the declaration and that same `@input`
  // silently becomes a native listener — firing on composition and bypassing the pointer/focus
  // filtering in terminalUserInput entirely, which is the whole reason the event exists.
  it("declares `input` as a component emit, which is what shadows the native one", async () => {
    expect(declaredEmits(Terminal)).toContain("input");
  });
});
