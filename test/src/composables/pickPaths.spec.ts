// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { filePickerOpen, pickPaths } from "../../../src/composables/pickPaths";

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("pickPaths", () => {
  it("returns the chosen paths", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { paths: ["/a", "/b"] })));
    await expect(pickPaths()).resolves.toEqual({ paths: ["/a", "/b"], error: null });
  });

  it("asks for a folder only when told to", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { paths: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await pickPaths({ directory: true });
    await pickPaths();
    expect(fetchMock.mock.calls.map((c) => c[1]?.body)).toEqual(['{"directory":true}', '{"directory":false}']);
  });

  // A cancel is a 200 with no paths, and must NOT read as something to complain about.
  it("reports no error when the user cancels", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { paths: [] })));
    await expect(pickPaths()).resolves.toEqual({ paths: [], error: null });
  });

  // #1447: this is the whole bug. The route said what was wrong and every caller dropped it.
  it("carries the server's explanation for a 500", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { error: "No file dialog on this host — install zenity" })));
    await expect(pickPaths()).resolves.toEqual({ paths: [], error: "No file dialog on this host — install zenity" });
  });

  it("still reports something when the failing body has no message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>502</html>", { status: 502 })));
    const { error } = await pickPaths();
    expect(error).toContain("502");
  });

  it("reports a request that never got there", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch")));
    const { paths, error } = await pickPaths();
    expect(paths).toEqual([]);
    expect(error).toContain("Failed to fetch");
  });

  it("ignores non-string entries in the answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { paths: ["/a", 7, null] })));
    await expect(pickPaths()).resolves.toEqual({ paths: ["/a"], error: null });
  });
});

// #1527: the route answers only when the USER closes the dialog, and each request spawns one of its
// own — so a double-clicked button opened a dialog per click.
describe("pickPaths while a dialog is already open", () => {
  /** A pick-file request that stays unanswered until the test says the user closed the dialog. */
  function heldDialog() {
    let close: (body: unknown) => void = () => {};
    const held = new Promise<Response>((resolve) => (close = (body) => resolve(jsonResponse(200, body))));
    const fetchMock = vi.fn().mockReturnValue(held);
    vi.stubGlobal("fetch", fetchMock);
    return { fetchMock, close };
  }

  it("reads the second call as a cancel instead of opening another dialog", async () => {
    const { fetchMock, close } = heldDialog();
    const first = pickPaths({ directory: true });
    await expect(pickPaths({ directory: true })).resolves.toEqual({ paths: [], error: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    close({ paths: ["/a"] });
    await expect(first).resolves.toEqual({ paths: ["/a"], error: null });
  });

  it("says whether a dialog is open, so every picker button can disable itself", async () => {
    const { close } = heldDialog();
    expect(filePickerOpen.value).toBe(false);
    const first = pickPaths();
    expect(filePickerOpen.value).toBe(true);
    close({ paths: [] });
    await first;
    expect(filePickerOpen.value).toBe(false);
  });

  it("opens again once the dialog closed", async () => {
    const { close } = heldDialog();
    const first = pickPaths();
    close({ paths: ["/a"] });
    await first;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { paths: ["/b"] })));
    await expect(pickPaths()).resolves.toEqual({ paths: ["/b"], error: null });
  });

  // A guard that a failure leaves latched is worse than the bug: the button would never work again.
  it("opens again after a request that never got there", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch")));
    await pickPaths();
    expect(filePickerOpen.value).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { paths: ["/a"] })));
    await expect(pickPaths()).resolves.toEqual({ paths: ["/a"], error: null });
  });
});
