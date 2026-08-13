import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// A directory's chrome colours have to reach EVERY kind of grid cell, not just the Claude one.
// They were added for the Claude cell (#279/#281) and each later cell type had to remember to
// wire them up; #902 found that hole for theme/font, #914 for the name badge, and #1006 for these
// six colours — the same omission three times, because "remember to pass it" is the design.
//
// So this spec is stated per COLOUR and per CELL TYPE, as a grid: a new cell type that forgets the
// wiring fails here, and it fails saying which colour and which cell.

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

// The terminal itself is not what this is about — only the chrome the cell draws around it.
vi.mock("../../../src/components/Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["cwd", "persistKey", "sessionId", "connectKey", "launcher", "expanded", "zoomed", "hideHeader"],
    template: "<div />",
  },
}));

const CHROME = {
  name: "proj",
  badgeColor: "#ff6f5e",
  headerColor: "#06373d",
  headerTextColor: "#d8fff6",
  cellColor: "#04262a",
  cellBorderColor: "#0b6b6b",
  dotColor: "#ffd166",
  buttonColor: "#7fe3d0",
};

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/dir-config")) return { ok: true, json: async () => CHROME };
    if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
    if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/proj/a", scripts: [] }) };
    return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
  }) as unknown as typeof fetch;
});

// At module scope, not inside a test: a component's module load is not the test's work, and
// billing it to `testTimeout` is what makes the first test of a file the one that flakes.
const TerminalCell = (await import("../../../src/components/TerminalCell.vue")).default;
const LauncherCell = (await import("../../../src/components/LauncherCell.vue")).default;
const CommandCell = (await import("../../../src/components/CommandCell.vue")).default;

async function mountClaudeCell(cwd: string) {
  return mount(TerminalCell, {
    props: {
      uid: 1,
      expanded: false,
      zoomed: false,
      initialSessionId: "11111111-1111-1111-1111-111111111111",
      initialCwd: cwd,
      // Deliberately NOT `cwd`: a cell whose dir IS the workspace is badged WORKSPACE rather than
      // with the directory's `name` (see dirBadgeCells.spec.ts), and the badge assertion below is
      // about the name. The colours are the directory's either way.
      defaultCwd: "/home/me/workspace",
      presets: [],
      home: "/home/me",
      cancellable: false,
      openSessionIds: [],
      openCwds: [],
    },
  });
}

async function mountLauncherCell(cwd: string) {
  return mount(LauncherCell, {
    props: { uid: 2, expanded: false, zoomed: false, launcher: { index: 0, label: "shell" }, session: null, cwd, home: "/home/me" },
  });
}

async function mountCommandCell(cwd: string) {
  return mount(CommandCell, {
    props: { uid: 3, expanded: false, zoomed: false, command: { source: "script", index: 0, label: "build", cwd }, home: "/home/me" },
  });
}

const CELLS: [string, (cwd: string) => Promise<ReturnType<typeof mount>>][] = [
  ["the Claude cell", mountClaudeCell],
  ["the Shell (launcher) cell", mountLauncherCell],
  ["the Command cell", mountCommandCell],
];

// The style is emitted as CSS VARIABLES rather than plain background/color, so a status tint can
// still override while idle keeps the directory's colour — which is why these assert on the
// variable, not on a computed background.
const styleOf = (w: ReturnType<typeof mount>, selector: string) => w.find(selector).attributes("style") ?? "";

// A distinct directory per case: useDirConfig's fetch cache is module-level and outlives a test,
// so reusing one cwd would serve an earlier case's config to a later one.
let dirSeq = 0;
const freshCwd = () => `/proj/chrome-${++dirSeq}`;

describe.each(CELLS)("directory chrome colours reach %s", (_case, mountCell) => {
  it("tints the cell frame: background, border, idle dot and header buttons", async () => {
    const w = await mountCell(freshCwd());
    await flushPromises();
    const style = styleOf(w, ".cell");
    expect(style).toContain(`--cell-bg: ${CHROME.cellColor}`);
    expect(style).toContain(`--cell-border: ${CHROME.cellBorderColor}`);
    expect(style).toContain(`--cell-dot: ${CHROME.dotColor}`);
    expect(style).toContain(`--cell-btn: ${CHROME.buttonColor}`);
  });

  it("tints the header: background and text", async () => {
    const w = await mountCell(freshCwd());
    await flushPromises();
    const style = styleOf(w, ".cell-header");
    expect(style).toContain(`--cell-header-bg: ${CHROME.headerColor}`);
    expect(style).toContain(`--cell-header-fg: ${CHROME.headerTextColor}`);
  });

  // Already true before #1006 — kept so a refactor of the shared wiring can't drop it.
  it("still names the directory on its badge", async () => {
    const w = await mountCell(freshCwd());
    await flushPromises();
    expect(w.text()).toContain(CHROME.name);
  });
});

describe("a directory that configures nothing", () => {
  it.each(CELLS)("leaves %s on the theme defaults", async (_case, mountCell) => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
      if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/proj/bare", scripts: [] }) };
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;

    const w = await mountCell(freshCwd());
    await flushPromises();
    // No variables at all — the classes then fall through to their var() defaults.
    expect(styleOf(w, ".cell")).not.toContain("--cell-bg");
    expect(styleOf(w, ".cell-header")).not.toContain("--cell-header-bg");
  });
});
