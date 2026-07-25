import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  filesGotoIndex: vi.fn(),
  prsGotoIndex: vi.fn(),
  wikiGotoIndex: vi.fn(),
  browseGotoIndex: vi.fn(),
  accountingViewOpen: vi.fn(),
  submitText: vi.fn(),
  insertText: vi.fn(),
  openTerminalAt: vi.fn(),
  openFilePicker: vi.fn(),
}));
vi.mock("../../../src/composables/useFilesView", () => ({ filesGotoIndex: m.filesGotoIndex }));
vi.mock("../../../src/composables/usePrsView", () => ({ prsGotoIndex: m.prsGotoIndex }));
vi.mock("../../../src/composables/useWikiBrowse", () => ({ wikiGotoIndex: m.wikiGotoIndex }));
vi.mock("../../../src/composables/useCollectionBrowse", () => ({ browseGotoIndex: m.browseGotoIndex }));
vi.mock("../../../src/composables/useAccountingView", () => ({ accountingViewOpen: m.accountingViewOpen }));
vi.mock("../../../src/composables/useTerminalConnections", () => ({ submitText: m.submitText, insertText: m.insertText }));
vi.mock("../../../src/composables/useNewTerminal", () => ({ openTerminalAt: m.openTerminalAt }));
vi.mock("../../../src/composables/useFilePicker", () => ({ openFilePicker: m.openFilePicker }));

import { runHeaderButton } from "../../../src/composables/useHeaderAction";
import type { HeaderButton } from "../../../src/composables/useHeaderButtons";

const btn = (over: Partial<HeaderButton>): HeaderButton => ({ id: "x", label: "X", run: "open", ...over });

describe("runHeaderButton", () => {
  beforeEach(() => vi.clearAllMocks());

  it("input → submitText into the session's slot", () => {
    runHeaderButton(btn({ run: "input", text: "/compact" }), "single", "/x");
    expect(m.submitText).toHaveBeenCalledWith("single", "/compact");
  });

  it("input without a slot key is a no-op", () => {
    runHeaderButton(btn({ run: "input", text: "/compact" }), null, "/x");
    expect(m.submitText).not.toHaveBeenCalled();
  });

  it("open url → window.open for http(s), ignores other schemes", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    runHeaderButton(btn({ run: "open", open: { url: "https://x" } }), null, null);
    expect(open).toHaveBeenCalledWith("https://x", "_blank", "noopener,noreferrer");
    open.mockClear();
    runHeaderButton(btn({ run: "open", open: { url: "javascript:alert(1)" } }), null, null);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("open reveal → POST /api/open-dir (desktop: native file manager)", () => {
    const f = vi.fn(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal("fetch", f);
    runHeaderButton(btn({ run: "open", open: { reveal: "/dir" } }), null, null);
    expect(f).toHaveBeenCalledWith("/api/open-dir", expect.objectContaining({ method: "POST" }));
    vi.unstubAllGlobals();
  });

  it("open reveal on a touch device → in-app file browser, not the host file manager", () => {
    const orig = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes("coarse"),
      media: q,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    const f = vi.fn(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal("fetch", f);
    try {
      runHeaderButton(btn({ run: "open", open: { reveal: "/dir" } }), null, null);
      expect(m.filesGotoIndex).toHaveBeenCalledWith("/dir");
      expect(f).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      window.matchMedia = orig;
    }
  });

  it("open files → filesGotoIndex; open view routes to the matching nav (else files)", () => {
    runHeaderButton(btn({ run: "open", open: { files: "/dir" } }), null, null);
    expect(m.filesGotoIndex).toHaveBeenCalledWith("/dir");
    runHeaderButton(btn({ run: "open", open: { view: "prs" } }), null, null);
    expect(m.prsGotoIndex).toHaveBeenCalled();
    runHeaderButton(btn({ run: "open", open: { view: "diff" } }), null, "/c");
    expect(m.filesGotoIndex).toHaveBeenLastCalledWith("/c");
  });

  it("open terminal → openTerminalAt with the dir and the triggering cell's slot key", () => {
    runHeaderButton(btn({ run: "open", open: { terminal: "/proj" } }), "cell-4", "/proj");
    expect(m.openTerminalAt).toHaveBeenCalledWith("/proj", "cell-4");
  });

  it("open pickFile → opens the in-browser file picker seeded at the cwd; its onSelect inserts the path", () => {
    runHeaderButton(btn({ run: "open", open: { pickFile: true } }), "single", "/proj");
    expect(m.openFilePicker).toHaveBeenCalledWith(expect.objectContaining({ start: "/proj" }));
    // Simulate the user choosing a file — the request's callback inserts it into the slot.
    const req = m.openFilePicker.mock.calls[0][0] as { onSelect: (paths: string[]) => void };
    req.onSelect(["/a/b.ts"]);
    expect(m.insertText).toHaveBeenCalledWith("single", expect.stringContaining("/a/b.ts"));
  });

  it("open pickFile without a slot key is a no-op (no picker)", () => {
    runHeaderButton(btn({ run: "open", open: { pickFile: true } }), null, null);
    expect(m.openFilePicker).not.toHaveBeenCalled();
  });

  it("shell → defensive no-op warn (Terminal.vue emits `run` instead; server suppresses shell here)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    runHeaderButton(btn({ run: "shell" }), "single", "/x");
    expect(m.submitText).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
