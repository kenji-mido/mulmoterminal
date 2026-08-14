import { describe, it, expect, vi, beforeAll } from "vitest";
import { shallowMount } from "@vue/test-utils";
import { ref } from "vue";

// The regression this exists for (#1367): the `env` chip was wired into TerminalCell's chip row
// only, and a LAUNCHER cell is not a TerminalCell — it is CellShell around this component, whose
// own `header-lead` slot is the only place it has for a chip. So the one cell that actually runs
// `yarn dev` was the one cell that never showed which port it got. Nothing failed; the chip was
// simply absent, which is indistinguishable from a project that declares nothing.
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

// xterm cannot open() in jsdom, and none of it is the subject here — this is about which chip the
// HEADER offers, which is decided before a byte reaches the terminal.
vi.mock("../../../src/composables/useTerminalConnections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/composables/useTerminalConnections")>()),
  attach: () => {},
  detach: () => {},
}));

const ENV = [{ name: "PORT", value: "3010", url: "http://localhost:3010" }];
const BUTTONS = [{ id: "deploy", label: "Deploy", run: "shell" as const }];
vi.mock("../../../src/composables/useHeaderButtons", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/composables/useHeaderButtons")>()),
  useHeaderButtons: () => ({ buttons: ref(BUTTONS), chips: ref(null), env: ref(ENV), refresh: () => Promise.resolve() }),
}));

// jsdom has no ResizeObserver, and the terminal observes its own container for the fit.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const Terminal = (await import("../../../src/components/Terminal.vue")).default;

const mountTerminal = (props: Record<string, unknown>) =>
  shallowMount(Terminal, { props: { sessionId: null, connectKey: 0, cwd: "/work/proj", ...props }, global: { stubs: { teleport: true } } });

describe("Terminal header — the per-tree env chip", () => {
  // A launcher terminal fills no `header-lead`, so it gets the default: branch chip + env chip.
  it("offers it to a launcher terminal, which has nowhere else to show it", () => {
    const w = mountTerminal({ launcher: { index: 1 } });
    expect(w.findComponent({ name: "WorktreeEnvChip" }).props("values")).toEqual(ENV);
  });

  it("offers it to a command terminal too", () => {
    const w = mountTerminal({ command: "yarn dev" });
    expect(w.findComponent({ name: "WorktreeEnvChip" }).props("values")).toEqual(ENV);
  });

  // Buttons are the half that IS session-scoped: a command/launcher terminal has no session and
  // does not handle `run`, so it must still show none — the fetch is shared, the gate is not.
  // Asked by the label the buttons actually render (`aria-label`), so the assertion can fail: the
  // first version of it named a data-testid this component does not have, and passed on every
  // input (CodeRabbit review on #1367).
  it("still shows no action buttons on those cells, though the fetch now happens", () => {
    expect(mountTerminal({ launcher: { index: 1 } }).findAll('[aria-label="Deploy"]')).toHaveLength(0);
    expect(mountTerminal({ command: "yarn dev" }).findAll('[aria-label="Deploy"]')).toHaveLength(0);
    // …and a session terminal, which is what the gate is FOR, still shows them.
    expect(mountTerminal({ sessionId: "s1" }).findAll('[aria-label="Deploy"]')).toHaveLength(1);
  });
});
