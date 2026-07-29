import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FilePickerHost from "../../../src/components/FilePickerHost.vue";
import { openFilePicker, closeFilePicker } from "../../../src/composables/useFilePicker";

describe("FilePickerHost", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ path: "/home/me/proj", parent: "/home/me", home: "/home/me", entries: [{ name: "a.ts", path: "/home/me/proj/a.ts", dir: false }] }),
    })) as unknown as typeof fetch;
  });
  afterEach(() => closeFilePicker());

  it("renders nothing until a request is parked, then shows the file picker", async () => {
    const w = mount(FilePickerHost);
    await flushPromises();
    expect(w.find('[role="dialog"]').exists()).toBe(false);

    openFilePicker({ start: "/home/me/proj", onSelect: vi.fn() });
    await flushPromises();
    const dialog = w.find('[role="dialog"][aria-label="Select file"]');
    expect(dialog.exists()).toBe(true);
    // The file picker requested the files-included listing at the seeded path.
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/dir-list?path=%2Fhome%2Fme%2Fproj&files=1"));
  });

  it("hands the tapped file to the request's callback and closes", async () => {
    const onSelect = vi.fn();
    const w = mount(FilePickerHost);
    openFilePicker({ start: "/home/me/proj", onSelect });
    await flushPromises();
    await w.find('[data-testid="dir-pick-file"]').trigger("click");
    await flushPromises();
    expect(onSelect).toHaveBeenCalledWith(["/home/me/proj/a.ts"]);
    expect(w.find('[role="dialog"]').exists()).toBe(false); // closed after selection
  });
});
