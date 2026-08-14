import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import DirIcon from "../../../src/components/DirIcon.vue";
import CockpitHeader from "../../../src/components/CockpitHeader.vue";
import CellLaunchForm from "../../../src/components/CellLaunchForm.vue";
import LauncherCell from "../../../src/components/LauncherCell.vue";
import CommandCell from "../../../src/components/CommandCell.vue";
import TerminalCell from "../../../src/components/TerminalCell.vue";

// The directory's `icon` image (#1421). Written alongside dirBadgeCells.spec.ts and for the same
// reason: what matters is not that one component can render an <img>, but that every place a
// project is identified actually shows it — a cell that doesn't is indistinguishable from a
// directory that configured no icon.

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

vi.mock("../../../src/components/Terminal.vue", () => ({
  default: { name: "TerminalView", props: ["sessionId", "connectKey", "cwd", "launcher", "command", "hideHeader"], template: "<div />" },
}));

const ICON = "/api/dir-icon?cwd=%2Fproj";

function serveDirConfig(dirConfig: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/dir-config")) return { ok: true, json: async () => dirConfig };
    if (u.includes("/api/scripts")) return { ok: true, json: async () => ({ cwd: "/x", scripts: [] }) };
    if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ sessions: [] }) };
    if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: false, base: null, worktrees: [] }) };
    return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
  }) as unknown as typeof fetch;
}

const iconOf = (w: { find: (s: string) => { exists: () => boolean; attributes: (a: string) => string | undefined } }) => w.find('[data-testid="dir-icon"]');

// The icon takes the browser-tab position — FIRST in its header, ahead of the status dot. Pinned
// because it is a placement decision, not an accident: reading the row starts with which project
// this is, and a later chip added at the front would quietly undo that.
const leads = (w: { element: Element }): boolean => {
  const icon = w.element.querySelector('img[data-testid="dir-icon"]');
  return icon !== null && icon.parentElement?.firstElementChild === icon;
};

describe("DirIcon", () => {
  it("renders the image, and nothing at all without one", () => {
    expect(
      mount(DirIcon, { props: { src: ICON } })
        .get("img")
        .attributes("src"),
    ).toBe(ICON);
    // `v-if`, not an empty img: a directory with no icon must not leave a gap in the header row.
    expect(mount(DirIcon, { props: { src: null } }).html()).toBe("<!--v-if-->");
    expect(mount(DirIcon, { props: { src: "" } }).html()).toBe("<!--v-if-->");
  });

  // Decorative: the name badge and the path already say which directory this is, so a screen
  // reader must not be made to say it a third time.
  it("is hidden from assistive technology and cannot be dragged out", () => {
    const img = mount(DirIcon, { props: { src: ICON } }).get("img");
    expect(img.attributes("alt")).toBe("");
    expect(img.attributes("aria-hidden")).toBe("true");
    expect(img.attributes("draggable")).toBe("false");
  });

  it("sizes itself square, at the caller's size", () => {
    expect(
      mount(DirIcon, { props: { src: ICON } })
        .get("img")
        .attributes("style"),
    ).toContain("width: 14px");
    expect(
      mount(DirIcon, { props: { src: ICON, size: 13 } })
        .get("img")
        .attributes("style"),
    ).toContain("width: 13px");
  });

  // A renamed file or an unreachable host must leave NO trace: a broken-image glyph in a cell
  // header reads as this app being broken, rather than as a setting pointing at nothing.
  it("removes itself when the image fails to load, and comes back for a new one", async () => {
    const w = mount(DirIcon, { props: { src: ICON } });
    await w.get("img").trigger("error");
    expect(w.html()).toBe("<!--v-if-->");
    await w.setProps({ src: "https://example.com/logo.png" });
    expect(w.get("img").attributes("src")).toBe("https://example.com/logo.png");
  });
});

describe("every grid cell shows the directory's icon", () => {
  const DIR = { name: "PROD", iconUrl: ICON };

  it("LauncherCell", async () => {
    serveDirConfig(DIR);
    const w = mount(LauncherCell, {
      props: { uid: 1, expanded: false, zoomed: false, launcher: { shell: true, label: "Shell" }, session: null, cwd: "/proj/icon-launcher", home: "/home/me" },
    });
    await flushPromises();
    expect(w.findComponent(DirIcon).get("img").attributes("src")).toBe(ICON);
    expect(leads(w)).toBe(true);
    w.unmount();
  });

  it("CommandCell", async () => {
    serveDirConfig(DIR);
    const w = mount(CommandCell, {
      props: {
        uid: 2,
        expanded: false,
        zoomed: false,
        command: { source: "script" as const, index: 0, label: "build", cwd: "/proj/icon-command" },
        home: "/home/me",
      },
    });
    await flushPromises();
    expect(w.findComponent(DirIcon).get("img").attributes("src")).toBe(ICON);
    expect(leads(w)).toBe(true);
    w.unmount();
  });

  it("TerminalCell", async () => {
    serveDirConfig(DIR);
    const w = mount(TerminalCell, {
      props: {
        uid: 3,
        expanded: false,
        zoomed: false,
        initialSessionId: "11111111-1111-1111-1111-111111111111",
        initialCwd: "/proj/icon-terminal",
        defaultCwd: "/home/me/workspace",
        presets: [],
        home: "/home/me",
        cancellable: false,
        openSessionIds: [],
        openCwds: [],
      },
    });
    await flushPromises();
    expect(w.findComponent(DirIcon).get("img").attributes("src")).toBe(ICON);
    expect(leads(w)).toBe(true);
    w.unmount();
  });
});

// The two zoomed view modes are not TerminalCell (docs/grid-view-modes.md) — the roster row and
// the filmstrip thumbnail share CockpitHeader — so an icon that only reached the tiled grid would
// vanish the moment a cell is enlarged.
describe("CockpitHeader", () => {
  const base = { status: "idle" as const, agent: "claude", cwd: "/home/me/proj", home: "/home/me", headerColor: null, headerTextColor: null };

  it("leads the bar with the icon, and shows nothing when the directory sets none", () => {
    const w = mount(CockpitHeader, { props: { ...base, iconUrl: ICON } });
    expect(w.get('[data-testid="dir-icon"]').attributes("src")).toBe(ICON);
    expect(leads(w)).toBe(true);
    expect(iconOf(mount(CockpitHeader, { props: base })).exists()).toBe(false);
  });
});

// The launcher shows directories that have no cell of their own, so this reads the config
// through useDirIcons rather than off a mounted cell.
describe("the launcher's directory chips", () => {
  it("show each directory's icon", async () => {
    serveDirConfig({ name: "PROD", iconUrl: ICON });
    const w = mount(CellLaunchForm, {
      props: {
        dir: "/repo",
        agent: "claude" as const,
        choice: null,
        defaultCwd: "/home/me/ws",
        presets: [{ label: "repo", path: "/repo" }],
        openSessionIds: [],
      },
      global: { stubs: { ModelPicker: true } },
    });
    await flushPromises();
    expect(w.findComponent(DirIcon).get("img").attributes("src")).toBe(ICON);
    w.unmount();
  });
});
