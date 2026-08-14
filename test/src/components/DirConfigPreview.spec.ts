import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import DirConfigPreview from "../../../src/components/DirConfigPreview.vue";

const detail = (over: Record<string, unknown> = {}) => ({
  exists: true,
  file: "/proj/a/.mulmoterminal.json",
  config: { name: "proj", headerColor: "#2b3a55" },
  localFile: null,
  source: { applied: ["name", "headerColor"], ignored: [], unknown: [], local: [] },
  ...over,
});

let served: Record<string, unknown> = detail();
let requested: string[] = [];

beforeEach(() => {
  served = detail();
  requested = [];
  globalThis.fetch = vi.fn(async (url: string) => {
    requested.push(String(url));
    return { ok: true, json: async () => served };
  }) as unknown as typeof fetch;
});

const mountPreview = (paths: string[]) => mount(DirConfigPreview, { props: { paths } });
const expand = async (w: ReturnType<typeof mountPreview>, index = 0) => {
  await w.findAll('[data-testid="dir-preview-row"]')[index].trigger("toggle");
  await flushPromises();
};

describe("DirConfigPreview", () => {
  it("says so when there is nothing to list", () => {
    expect(mountPreview([]).text()).toContain("No directories yet");
  });

  it("lists the directories by name, not in the order they were handed over", () => {
    const w = mountPreview(["/x/zeta", "/y/alpha", "/w/proj10", "/w/proj2"]);
    const names = w.findAll('[data-testid="dir-preview-name"]').map((s) => s.text());
    expect(names).toEqual(["alpha", "proj2", "proj10", "zeta"]);
  });

  it("lists a row per directory without reading any of them yet", () => {
    const w = mountPreview(["/proj/a", "/proj/b"]);
    expect(w.findAll('[data-testid="dir-preview-row"]')).toHaveLength(2);
    // Opening the modal with a long history must not fire a read per row.
    expect(requested).toEqual([]);
  });

  it("reads a directory when it is expanded, and shows its values with a swatch", async () => {
    const w = mountPreview(["/proj/a"]);
    await expand(w);
    expect(requested).toEqual(["/api/dir-config-detail?cwd=%2Fproj%2Fa"]);
    expect(w.find('[data-testid="dir-preview-values"]').text()).toContain("#2b3a55");
    expect(w.find('[data-testid="dir-preview-swatch"]').attributes("style")).toContain("rgb(43, 58, 85)");
  });

  it("does not read the same directory twice", async () => {
    const w = mountPreview(["/proj/a"]);
    await expand(w);
    await expand(w); // collapse and expand again
    expect(requested).toHaveLength(1);
  });

  // The whole point of the preview: a key that was written and then dropped, and a key that
  // isn't a setting at all, have to be visible — the resolved values alone can't say either.
  it("names the keys that were dropped and the keys it does not recognise", async () => {
    served = detail({ source: { applied: ["name"], ignored: ["cellColor"], unknown: ["badgeColour"] } });
    const w = mountPreview(["/proj/a"]);
    await expand(w);
    expect(w.find('[data-testid="dir-preview-ignored"]').text()).toContain("cellColor");
    expect(w.find('[data-testid="dir-preview-unknown"]').text()).toContain("badgeColour");
  });

  it("distinguishes a directory with no file from one whose file applied nothing", async () => {
    served = detail({ file: null, config: {} });
    const w = mountPreview(["/proj/a"]);
    await expand(w);
    expect(w.text()).toContain("uses the global settings");

    served = detail({ config: {}, source: { applied: [], ignored: ["cellColor"], unknown: [] } });
    const w2 = mountPreview(["/proj/b"]);
    await expand(w2);
    expect(w2.text()).toContain("sets nothing this app applies");
  });

  // A preset outliving its project: the row must not read as a working directory with no config,
  // which is what the fallback in workspaceFromQuery used to make it look like (Codex, #952).
  it("says a directory is gone rather than calling it unconfigured", async () => {
    served = detail({ exists: false, file: null, config: {} });
    const w = mountPreview(["/proj/deleted"]);
    await expand(w);
    expect(w.find('[data-testid="dir-preview-gone"]').exists()).toBe(true);
    expect(w.text()).not.toContain("uses the global settings");
  });

  it("retries a directory whose read failed instead of showing it as empty forever", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const w = mountPreview(["/proj/a"]);
    await expand(w);
    expect(w.text()).toContain("Reading…");

    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => detail() })) as unknown as typeof fetch;
    await expand(w);
    expect(w.find('[data-testid="dir-preview-values"]').text()).toContain("proj");
  });

  it("forgets a directory that leaves the list", async () => {
    const w = mountPreview(["/proj/a"]);
    await expand(w);
    await w.setProps({ paths: ["/proj/b"] }); // the preset was deleted
    await flushPromises();
    expect(w.find('[data-testid="dir-preview-values"]').exists()).toBe(false);
  });
});

// Two files means the panel has to say which one decided a value — and must not claim a file
// beats one that is not there.
describe("the local override file (#1430)", () => {
  it("names both files and lists the keys the local one took over", async () => {
    served = detail({
      localFile: "/proj/a/.mulmoterminal.local.json",
      source: { applied: ["name", "headerColor"], ignored: [], unknown: [], local: ["headerColor"] },
    });
    const w = mountPreview(["/proj/a"]);
    await expand(w);
    expect(w.get('[data-testid="dir-preview-local-file"]').text()).toContain("/proj/a/.mulmoterminal.local.json");
    expect(w.get('[data-testid="dir-preview-local-file"]').text()).toContain("wins over the file above");
    expect(w.get('[data-testid="dir-preview-local-keys"]').text()).toContain("headerColor");
    expect(w.text()).toContain("those files");
  });

  // Codex on #1431: a directory may carry the local file ALONE, and saying it beats a file that
  // does not exist sends the reader looking for one.
  it("does not claim to beat a shared file that is not there", async () => {
    served = detail({ file: null, localFile: "/proj/a/.mulmoterminal.local.json" });
    const w = mountPreview(["/proj/a"]);
    await expand(w);
    const line = w.get('[data-testid="dir-preview-local-file"]').text();
    expect(line).toContain("(this checkout only)");
    expect(line).not.toContain("wins over the file above");
    expect(w.text()).toContain("that file");
    expect(w.text()).not.toContain("those files");
  });

  it("says nothing about a local file when there is none", async () => {
    const w = mountPreview(["/proj/a"]);
    await expand(w);
    expect(w.find('[data-testid="dir-preview-local-file"]').exists()).toBe(false);
    expect(w.find('[data-testid="dir-preview-local-keys"]').exists()).toBe(false);
  });
});
