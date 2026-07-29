// The in-browser folder/file picker (remote/mobile work). It exists because the native dialog
// (/api/pick-file) opens on the SERVER's display — from a phone that dialog is invisible, so the
// picker would appear to hang forever.
//
// What a port has to preserve is the navigation contract with /api/dir-list: dir mode asks for
// folders and confirms the folder SHOWN, file mode asks for files (`files=1`) and selects the one
// tapped. Get either backwards and the picker still renders — it just never picks what the user
// meant.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import DirPickerModal from "../../../src/components/DirPickerModal.vue";

const HOME = "/home/u";
const APP = `${HOME}/app`;
const enc = encodeURIComponent;
const listing = (over: Record<string, unknown> = {}) => ({
  path: APP,
  parent: HOME,
  home: HOME,
  entries: [
    { name: "src", path: `${APP}/src`, dir: true },
    { name: "notes.md", path: `${APP}/notes.md`, dir: false },
  ],
  ...over,
});

const stubFetch = (payload: unknown = listing(), ok = true) => {
  const f = vi.fn().mockResolvedValue({ ok, json: async () => payload });
  vi.stubGlobal("fetch", f);
  return f;
};

const urlsOf = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => String(c[0]));

async function open(props: Record<string, unknown> = {}, payload?: unknown) {
  const f = stubFetch(payload ?? listing());
  const w = mount(DirPickerModal, { props });
  await flushPromises();
  return { w, f };
}

describe("DirPickerModal", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("lists the starting directory on open", async () => {
    const { w, f } = await open({ start: APP });
    expect(urlsOf(f)[0]).toContain(`path=${enc(APP)}`);
    expect(w.text()).toContain("src");
  });

  it("asks for no particular path when none is given, so the server picks the default", async () => {
    const { f } = await open();
    expect(urlsOf(f)[0]).toBe("/api/dir-list");
  });

  // dir mode must NOT ask for files — a folder picker listing files invites picking one.
  it("dir mode lists folders only; file mode asks for files too", async () => {
    const { f: dirFetch } = await open({ mode: "dir" });
    expect(urlsOf(dirFetch)[0]).not.toContain("files=1");

    const { f: fileFetch } = await open({ mode: "file" });
    expect(urlsOf(fileFetch)[0]).toContain("files=1");
  });

  it("navigates into a folder instead of selecting it", async () => {
    const { w, f } = await open({ mode: "file" });
    await w.get('[data-testid="dir-pick-dir"]').trigger("click");
    await flushPromises();
    expect(urlsOf(f)[1]).toContain(enc(`${APP}/src`));
    expect(w.emitted("select")).toBeUndefined();
  });

  it("file mode selects the file that was tapped", async () => {
    const { w } = await open({ mode: "file" });
    await w.get('[data-testid="dir-pick-file"]').trigger("click");
    expect(w.emitted("select")?.[0]).toEqual([`${APP}/notes.md`]);
  });

  // The whole point of dir mode: the confirm button chooses the folder currently shown, which is
  // never one of the rows.
  it("dir mode confirms the folder currently shown", async () => {
    const { w } = await open({ mode: "dir" });
    await w.get('[data-testid="dir-pick-confirm"]').trigger("click");
    expect(w.emitted("select")?.[0]).toEqual([APP]);
  });

  it("has no confirm button in file mode (the file itself is the choice)", async () => {
    const { w } = await open({ mode: "file" });
    expect(w.find('[data-testid="dir-pick-confirm"]').exists()).toBe(false);
  });

  it("walks up to the parent the server reported", async () => {
    const { w, f } = await open();
    await w.get('[title="Up one level"]').trigger("click");
    await flushPromises();
    expect(urlsOf(f)[1]).toContain(enc(HOME));
  });

  it("disables Up at a root, where the server reports no parent", async () => {
    const { w } = await open({}, listing({ path: "/", parent: null }));
    expect(w.get('[title="Up one level"]').attributes("disabled")).toBeDefined();
  });

  it("jumps home", async () => {
    const { w, f } = await open({ start: APP });
    await w.get('[title="Home"]').trigger("click");
    await flushPromises();
    expect(urlsOf(f)[1]).toContain(enc(HOME));
  });

  // A folder the user cannot read must say so — not sit on "Loading…" forever, which from a
  // phone is indistinguishable from the app being broken.
  it("reports a folder it could not read", async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    vi.stubGlobal("fetch", f);
    const w = mount(DirPickerModal);
    await flushPromises();
    expect(w.text()).toContain("Could not read this folder");
    expect(w.text()).not.toContain("Loading…");
  });

  it("survives a network failure the same way", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const w = mount(DirPickerModal);
    await flushPromises();
    expect(w.text()).toContain("Could not read this folder");
  });

  it("says an empty folder is empty, in the words of its mode", async () => {
    const { w } = await open({ mode: "dir" }, listing({ entries: [] }));
    expect(w.text()).toContain("No sub-folders here.");
    const { w: fileW } = await open({ mode: "file" }, listing({ entries: [] }));
    expect(fileW.text()).toContain("Nothing here.");
  });

  it("closes on Cancel", async () => {
    const { w } = await open();
    const cancel = w.findAll("button").find((b) => b.text() === "Cancel");
    await cancel?.trigger("click");
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("closes on the ✕ button", async () => {
    const { w } = await open();
    await w.get('[aria-label="Close"]').trigger("click");
    expect(w.emitted("close")).toHaveLength(1);
  });

  // Tapping the backdrop closes; tapping INSIDE the dialog must not — a mis-scoped handler
  // dismisses the picker on every tap and looks like the app rejecting input.
  it("closes on a backdrop click but not on a click inside the dialog", async () => {
    const { w } = await open();
    await w.get('[role="dialog"]').trigger("click");
    expect(w.emitted("close")).toBeUndefined();
    await w.get("div").trigger("click");
    expect(w.emitted("close")).toHaveLength(1);
  });
});
