import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSessionHideDelete, deleteSessionPrompt } from "../../../src/composables/useSessionHideDelete";

// The two ways a session leaves the launcher's resume list, and the difference between them is the
// whole point: hiding stops OFFERING it and keeps the transcript, deleting removes the transcript.
// Only the second can be regretted, so only the second asks.

const row = { id: "s-1", title: "the login fix" };

const calls = () => vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hiding a session", () => {
  it("posts to the hide route and re-reads the list", async () => {
    const onChanged = vi.fn();
    const { hideSession } = useSessionHideDelete(onChanged);
    await hideSession(row);
    expect(calls()).toEqual(["/api/session/s-1/hide"]);
    expect(onChanged).toHaveBeenCalled();
  });

  // Nothing is destroyed, so asking would be a dialog whose only answer is yes.
  it("does not ask first", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { hideSession } = useSessionHideDelete(vi.fn());
    await hideSession(row);
    expect(confirm).not.toHaveBeenCalled();
  });

  // The list is re-read even when the request failed: what is listed is the server's answer, and a
  // row this removed by hand would disagree with it.
  it("still re-reads the list when the request fails", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const onChanged = vi.fn();
    const { hideSession } = useSessionHideDelete(onChanged);
    await hideSession(row);
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("deleting a session", () => {
  it("asks first, and posts to the delete route when confirmed", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onChanged = vi.fn();
    const { deleteSession } = useSessionHideDelete(onChanged);
    await deleteSession(row);
    expect(confirm).toHaveBeenCalledWith(deleteSessionPrompt("the login fix"));
    expect(calls()).toEqual(["/api/session/s-1/delete"]);
    expect(onChanged).toHaveBeenCalled();
  });

  it("does nothing at all when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onChanged = vi.fn();
    const { deleteSession } = useSessionHideDelete(onChanged);
    await deleteSession(row);
    expect(calls()).toEqual([]);
    expect(onChanged).not.toHaveBeenCalled();
  });

  // The prompt has to say what is lost. "It cannot be undone" is the part a user acts on.
  it("says the transcript is removed and that it cannot be undone", () => {
    const prompt = deleteSessionPrompt("the login fix");
    expect(prompt).toContain("the login fix");
    expect(prompt).toContain("cannot be undone");
    expect(prompt).toContain("transcript");
  });
});

describe("while one is in flight", () => {
  it("refuses a second action on any row until the first finishes", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = vi.fn(async () => {
      await held;
      return { ok: true, json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;

    const { hideSession, busyId } = useSessionHideDelete(vi.fn());
    const first = hideSession(row);
    expect(busyId.value).toBe("s-1");
    await hideSession({ id: "s-2", title: "another" }); // must not fire while the first is open
    expect(calls()).toEqual(["/api/session/s-1/hide"]);
    release();
    await first;
    expect(busyId.value).toBeNull();
  });
});
