import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, defineComponent, ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useSessionContext } from "../../../src/composables/useSessionContext";
import type { TerminalAgent } from "../../../common/sessionAgent";

function withSetup<T>(composable: () => T): { result: T; unmount: () => void } {
  let result!: T;
  const app = createApp(defineComponent({ setup: () => ((result = composable()), () => null) }));
  app.mount(document.createElement("div"));
  return { result, unmount: () => app.unmount() };
}

const jsonResponse = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) }) as unknown as Response;

describe("useSessionContext", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches /api/session/:id (with cwd) and exposes the running model", async () => {
    const fetchMock = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(jsonResponse({ context: { model: "claude-opus-4-8", contextTokens: 42 } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = withSetup(() => useSessionContext(ref<string | null>("sess-1"), ref<string | null>("/proj")));
    await flushPromises();
    // #1393: every request carries a deadline now, so the init is no longer absent.
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/session/sess-1?agent=claude&cwd=%2Fproj");
    expect(result.context.value?.model).toBe("claude-opus-4-8");
    unmount();
  });

  // The badges are read from the agent's OWN log (#1465), so a terminal that is not Claude has to
  // say which one it is — a request without it is answered from Claude's transcript, where a codex
  // session has no file and the badge would stay empty.
  it("names the agent it is asking about", async () => {
    const fetchMock = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(jsonResponse({ context: { model: "gpt-5.5", contextTokens: 42, contextWindow: 258_400 } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = withSetup(() => useSessionContext(ref<string | null>("sess-1"), ref<string | null>("/proj"), ref<TerminalAgent>("codex")));
    await flushPromises();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/session/sess-1?agent=codex&cwd=%2Fproj");
    expect(result.context.value?.contextWindow).toBe(258_400);
    unmount();
  });

  // Changing the agent changes which log the server reads, so it has to re-fetch — and clear the
  // old badge while it does, or a codex cell relaunched as claude keeps wearing `gpt-5.5`.
  it("re-fetches and drops the old model when the agent changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ context: { model: "gpt-5.5", contextTokens: 1 } }))
      .mockResolvedValueOnce({ ok: false } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const agent = ref<TerminalAgent>("codex");
    const { result, unmount } = withSetup(() => useSessionContext(ref<string | null>("sess-1"), ref<string | null>(null), agent));
    await flushPromises();
    expect(result.context.value?.model).toBe("gpt-5.5");
    agent.value = "claude";
    await flushPromises();
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/session/sess-1?agent=claude");
    expect(result.context.value).toBeNull(); // no stale codex model on a claude terminal
    unmount();
  });

  it("does not fetch and stays null when there is no session id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = withSetup(() => useSessionContext(ref<string | null>(null), ref<string | null>(null)));
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.context.value).toBeNull();
    unmount();
  });

  it("drops the old model when the session switches, even if the new fetch fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ context: { model: "claude-opus-4-8", contextTokens: 1 } }))
      .mockResolvedValueOnce({ ok: false } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const id = ref<string | null>("sess-1");
    const { result, unmount } = withSetup(() => useSessionContext(id, ref<string | null>(null)));
    await flushPromises();
    expect(result.context.value?.model).toBe("claude-opus-4-8");
    id.value = "sess-2"; // switch session; the refetch fails (ok:false)
    await flushPromises();
    expect(result.context.value).toBeNull(); // no stale sess-1 model
    unmount();
  });
});
