import { describe, it, expect, vi, beforeEach } from "vitest";
import { currentGitlabHosts, useAppConfig } from "../../../src/composables/useAppConfig";

// Echo the posted cwdPresets back as the server would, so presets.value reflects
// each save. useAppConfig's presets ref is per-call (not a singleton), so every
// useAppConfig() in these tests starts from an empty list.
function mockConfigFetch() {
  globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    return { ok: true, json: async () => ({ cwdPresets: body.cwdPresets ?? [] }) };
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  localStorage.clear();
  mockConfigFetch();
});

describe("useAppConfig — auto preset recording", () => {
  it("recordPreset prepends a new dir with a basename label", async () => {
    const { presets, recordPreset } = useAppConfig();
    await recordPreset("/home/me/alpha");
    expect(presets.value).toEqual([{ label: "alpha", path: "/home/me/alpha" }]);
  });

  it("moves an already-known dir to the front on reuse (most-recently-used)", async () => {
    const { presets, recordPreset } = useAppConfig();
    await recordPreset("/a/one");
    await recordPreset("/b/two");
    await recordPreset("/a/one"); // reuse → bumps to front
    expect(presets.value.map((p) => p.path)).toEqual(["/a/one", "/b/two"]);
  });

  it("keeps an existing entry's label when bumping it to the front", async () => {
    const { presets, recordPreset } = useAppConfig();
    presets.value = [
      { label: "two", path: "/b/two" },
      { label: "Custom", path: "/a/one" }, // a manual label from legacy cwdPresets
    ];
    await recordPreset("/a/one");
    expect(presets.value).toEqual([
      { label: "Custom", path: "/a/one" },
      { label: "two", path: "/b/two" },
    ]);
  });

  it("does not re-write when the dir is already at the front", async () => {
    const { presets, recordPreset } = useAppConfig();
    await recordPreset("/a");
    const before = vi.mocked(globalThis.fetch).mock.calls.length;
    await recordPreset("/a"); // already most-recent → no POST
    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(before);
    expect(presets.value.map((p) => p.path)).toEqual(["/a"]);
  });

  it("has no cap — keeps every distinct dir, newest first", async () => {
    const { presets, recordPreset } = useAppConfig();
    for (const d of ["/a", "/b", "/c", "/d", "/e", "/f"]) await recordPreset(d);
    expect(presets.value).toHaveLength(6);
    expect(presets.value[0].path).toBe("/f");
  });

  it("ignores a null or empty path", async () => {
    const { presets, recordPreset } = useAppConfig();
    await recordPreset(null);
    await recordPreset("");
    expect(presets.value).toEqual([]);
  });

  it("removePreset drops the matching path", async () => {
    const { presets, recordPreset, removePreset } = useAppConfig();
    await recordPreset("/a");
    await recordPreset("/b");
    await removePreset("/a");
    expect(presets.value.map((p) => p.path)).toEqual(["/b"]);
  });

  it("imports legacy localStorage recents (recent_dirs_v1) to the FRONT of presets on load, then clears the key", async () => {
    localStorage.setItem("recent_dirs_v1", JSON.stringify(["/r/one", "/r/two"]));
    globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
      if (!init?.body) return { ok: true, json: async () => ({ cwd: "/w", home: "/h", cwdPresets: [{ label: "kept", path: "/p/kept" }], soundFile: null }) };
      const body = init.body ? JSON.parse(init.body) : {};
      return { ok: true, json: async () => ({ cwdPresets: body.cwdPresets ?? [] }) };
    }) as unknown as typeof fetch;
    const { presets, loadConfig } = useAppConfig();
    await loadConfig();
    expect(presets.value).toEqual([
      { label: "one", path: "/r/one" }, // most-recent legacy dir prepended, ahead of existing
      { label: "two", path: "/r/two" },
      { label: "kept", path: "/p/kept" },
    ]);
    expect(localStorage.getItem("recent_dirs_v1")).toBeNull();
  });

  it("does not duplicate a legacy recent already present, but still clears the key", async () => {
    localStorage.setItem("recent_dirs_v1", JSON.stringify(["/p/kept", "/r/new"]));
    globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
      if (!init?.body) return { ok: true, json: async () => ({ cwd: "/w", home: "/h", cwdPresets: [{ label: "kept", path: "/p/kept" }], soundFile: null }) };
      const body = init.body ? JSON.parse(init.body) : {};
      return { ok: true, json: async () => ({ cwdPresets: body.cwdPresets ?? [] }) };
    }) as unknown as typeof fetch;
    const { presets, loadConfig } = useAppConfig();
    await loadConfig();
    expect(presets.value.map((p) => p.path)).toEqual(["/r/new", "/p/kept"]);
    expect(localStorage.getItem("recent_dirs_v1")).toBeNull();
  });

  it("loadConfig does not clobber a preset recorded while the initial GET is in flight (#164 review)", async () => {
    let releaseGet: () => void = () => {};
    const getGate = new Promise<void>((r) => {
      releaseGet = r;
    });
    globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
      if (!init?.body) {
        await getGate; // the initial GET stalls until we release it
        return { ok: true, json: async () => ({ cwd: "/w", home: "/h", cwdPresets: [], soundFile: null }) };
      }
      const body = init.body ? JSON.parse(init.body) : {};
      return { ok: true, json: async () => ({ cwdPresets: body.cwdPresets ?? [] }) };
    }) as unknown as typeof fetch;
    const { presets, loadConfig, recordPreset } = useAppConfig();
    const loading = loadConfig(); // GET in flight (stalled)
    await recordPreset("/launched/now"); // user launches before the GET resolves
    releaseGet(); // the stale (empty) GET snapshot now lands
    await loading;
    expect(presets.value.map((p) => p.path)).toEqual(["/launched/now"]);
  });

  it("serializes concurrent records so neither write clobbers the other (#163 review)", async () => {
    // A slow POST means two un-serialized records would both read the empty list and
    // the second would overwrite the first. Serialization keeps both.
    globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, json: async () => ({ cwdPresets: body.cwdPresets ?? [] }) };
    }) as unknown as typeof fetch;
    const { presets, recordPreset } = useAppConfig();
    await Promise.all([recordPreset("/a"), recordPreset("/b")]);
    expect(presets.value.map((p) => p.path).sort()).toEqual(["/a", "/b"]);
  });
});

// A saver reads the server's ECHO back into its ref. When the reader that validates that echo
// disagrees with the real interface, every entry is filtered out and the list silently EMPTIES on
// save — which is what a wrong field name did here (Codex review on #1294).
describe("useAppConfig — a save keeps what the server echoed", () => {
  // Echo whatever was posted, as the real /api/config does for a partial update.
  function echoPosted() {
    globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body: Record<string, unknown> = init?.body ? JSON.parse(init.body) : {};
      return { ok: true, json: async () => body };
    }) as unknown as typeof fetch;
  }

  beforeEach(echoPosted);

  it("keeps quick commands after saving them", async () => {
    const { quickCommands, saveQuickCommands } = useAppConfig();
    const next = [{ label: "Deploy", text: "/deploy" }];
    expect(await saveQuickCommands(next)).toBe(true);
    expect(quickCommands.value).toEqual(next);
  });

  it("keeps user MCP servers after saving them", async () => {
    const { userMcpServers, saveUserMcpServers } = useAppConfig();
    const next = [{ id: "docs", url: "https://example.test/mcp" }];
    expect(await saveUserMcpServers(next)).toBe(true);
    expect(userMcpServers.value).toEqual(next);
  });

  it("keeps launchers and pr repos after saving them", async () => {
    const { launchers, saveLaunchers, prRepos, savePrRepos } = useAppConfig();
    expect(await saveLaunchers([{ label: "zsh", command: "/bin/zsh" }])).toBe(true);
    expect(launchers.value).toEqual([{ label: "zsh", command: "/bin/zsh" }]);
    expect(await savePrRepos(["receptron/mulmoterminal"])).toBe(true);
    expect(prRepos.value).toEqual(["receptron/mulmoterminal"]);
  });
});

// loadConfig runs on every page open, and it used to take the server's arrays at face value while
// the SAVE paths filtered them through isLauncher/isQuickCommand/isUserMcpServer. A config file
// that was hand-edited (or written by an older version) therefore loaded entries the rest of the
// app assumes are well-formed — a launcher with no `command`, a quick command with no `text`.
describe("useAppConfig — loadConfig validates what the server sends", () => {
  function mockConfigGet(payload: Record<string, unknown>) {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => payload })) as unknown as typeof fetch;
  }

  it("keeps well-formed entries and drops malformed ones, per list", async () => {
    mockConfigGet({
      launchers: [{ label: "shell", command: "zsh" }, { label: "broken" }, "not an object"],
      quickCommands: [{ label: "hi", text: "hello" }, { label: "no text" }],
      userMcpServers: [{ id: "a", url: "https://x" }, { id: "b" }],
      pushKinds: ["finished", "not-a-kind"],
      prRepos: ["owner/repo", 42],
      cwdPresets: [{ label: "proj", path: "/p" }, { label: "no path" }],
    });
    const { loadConfig, launchers, quickCommands, userMcpServers, pushKinds, prRepos, presets } = useAppConfig();

    await loadConfig();

    expect(launchers.value).toEqual([{ label: "shell", command: "zsh" }]);
    expect(quickCommands.value).toEqual([{ label: "hi", text: "hello" }]);
    expect(userMcpServers.value).toEqual([{ id: "a", url: "https://x" }]);
    expect(pushKinds.value).toEqual(["finished"]);
    expect(prRepos.value).toEqual(["owner/repo"]);
    expect(presets.value).toEqual([{ label: "proj", path: "/p" }]);
  });

  // The declared self-hosted GitLab hosts (#1332). config.json-only, so the browser can never write
  // them — but it decides from them (an issue row on such a host can start work), and without this
  // adoption that decision is made against an empty list on every page.
  it("adopts the declared gitlab hosts, dropping anything that is not a string", async () => {
    mockConfigGet({ gitlabHosts: ["gitlab.hogefuga.com", 42] });
    const { loadConfig } = useAppConfig();

    await loadConfig();

    expect(currentGitlabHosts()).toEqual(["gitlab.hogefuga.com"]);
  });

  // A body that is not a JSON object at all must leave what is already shown alone rather than
  // throw past the caller — loadConfig is fire-and-forget on mount. The refs are module-level
  // singletons, so "unchanged" is the observable behaviour, not "empty".
  it("survives a non-object body and leaves the current lists alone", async () => {
    mockConfigGet({ launchers: [{ label: "shell", command: "zsh" }] });
    const { loadConfig, launchers } = useAppConfig();
    await loadConfig();
    const before = [...launchers.value];

    mockConfigGet([] as unknown as Record<string, unknown>);
    await expect(loadConfig()).resolves.toBeUndefined();

    expect(launchers.value).toEqual(before);
  });
});
