// @vitest-environment node
//
// muse's GUI MCP registration — the third shape, and the parts of it that a reader would otherwise
// have to take on trust. Everything asserted here was measured against muse-bin 0.1.0-R708.1
// before it was written down (see the module header).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TOOL_GROUPS } from "../../../common/toolGroups.js";
import { MUSE_PLUGIN_ID, museRegistrationMatches, musePluginEnv, musePluginManifest, writeMusePlugin } from "../../../server/agents/muse-mcp.js";

const BRIDGE = { command: "/opt/node/bin/node", args: ["/apps/mulmoterminal/server/mcp/bridge.mjs"] };
const PORT = 34567;

// Written once: every case builds the same manifest, and the port is part of it now.
const manifest = (bridge = BRIDGE, port: string | number = PORT) => musePluginManifest(bridge, port);

const capabilities = (manifest: Record<string, unknown>) =>
  (manifest.capabilities as { mcpServers: { id: string; transport: string; command: string[] }[] }).mcpServers;

describe("musePluginManifest", () => {
  it("declares one stdio server per tool group", () => {
    const servers = capabilities(manifest());
    expect(servers.map((s) => s.id)).toEqual([...TOOL_GROUPS]);
    expect(servers.every((s) => s.transport === "stdio")).toBe(true);
  });

  // NOTHING but argv reaches a plugin's MCP server: it is started with a curated environment of
  // muse's own, so neither an `env` block here nor the muse process's own environment arrives.
  // Both the group and the port therefore travel on the command line.
  it("passes the group and the port on the command line, after the bridge", () => {
    const render = capabilities(manifest()).find((s) => s.id === "render");
    expect(render?.command).toEqual([BRIDGE.command, ...BRIDGE.args, "--group", "render", "--port", String(PORT)]);
  });

  // A server that comes back on another port must not leave every muse cell talking to a port
  // nothing is listening on — the manifest changes, and the stamp below reads that as a reinstall.
  it("writes a different manifest when the port changes", () => {
    expect(manifest(BRIDGE, 34567)).not.toEqual(manifest(BRIDGE, 40000));
  });

  // Every group is registered whatever the directory switched on: `muse plugins install` is per
  // MACHINE, so the manifest cannot express a per-directory answer. The session's environment
  // narrows it instead (museGuiMcpEnv), and the bridge stands the rest down.
  it("registers every group, since installation cannot be per directory", () => {
    expect(capabilities(manifest())).toHaveLength(TOOL_GROUPS.length);
  });

  // muse composes the model-facing tool name out of the plugin id and the capability id
  // (`mcp__plugin_<plugin>_<server>__<tool>`, measured), so a `mulmoterminal-render` server id
  // inside a `mulmoterminal` plugin would repeat our name in every tool name in every listing.
  it("names the servers by group alone, under a plugin id that carries the app name", () => {
    expect(manifest().name).toBe(MUSE_PLUGIN_ID);
    expect(capabilities(manifest()).map((s) => s.id)).not.toContain("mulmoterminal-render");
  });

  it("declares the manifest directory muse discovers it by", () => {
    expect(manifest().compat).toMatchObject({ source: "native", manifestDir: ".muse-plugin" });
  });
});

describe("musePluginEnv", () => {
  // Every `muse plugins` verb answers "plugins are not available in this build" without it, and a
  // SESSION without it loads no plugins — so the registration would be inert rather than absent.
  it("carries the experimental flag the whole feature is behind", () => {
    expect(musePluginEnv()).toEqual({ MUSE_EXPERIMENTAL_PLUGINS: "1" });
  });
});

describe("writeMusePlugin", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mt-muse-plugin-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes the manifest where muse looks for it", () => {
    writeMusePlugin(dir, manifest());
    const written: unknown = JSON.parse(readFileSync(path.join(dir, ".muse-plugin", "plugin.json"), "utf8"));
    expect(written).toEqual(manifest());
  });

  it("creates the manifest directory when it is not there", () => {
    const nested = path.join(dir, "a", "b");
    expect(() => writeMusePlugin(nested, manifest())).not.toThrow();
    expect(readFileSync(path.join(nested, ".muse-plugin", "plugin.json"), "utf8")).toContain(MUSE_PLUGIN_ID);
  });
});

// What decides whether a spawn re-registers. This is asked of MUSE — `muse plugins inspect` — and
// the reason is a bug that shipped: the first version compared the manifest against a note it had
// written itself when it last installed, so anything that removed the plugin on muse's side left
// the two disagreeing forever. Our note said "installed", muse had nothing, and every muse cell
// came up with no GUI tools and nothing logged anywhere.
describe("museRegistrationMatches", () => {
  const inspected = (over: Record<string, unknown> = {}) => ({
    active: true,
    runtime_capabilities: TOOL_GROUPS.map((group) => ({ candidate: { capability_id: group }, status: "trusted_enabled" })),
    plugin: {
      capabilities: {
        mcp_servers: TOOL_GROUPS.map((group) => ({ id: group, command: [BRIDGE.command, ...BRIDGE.args, "--group", group, "--port", String(PORT)] })),
      },
    },
    ...over,
  });

  it("accepts a registration that is already ours", () => {
    expect(museRegistrationMatches(inspected(), manifest())).toBe(true);
  });

  // THE case. muse knows nothing about the plugin, so `inspect` fails and answers null.
  it("re-registers when muse has no such plugin", () => {
    expect(museRegistrationMatches(null, manifest())).toBe(false);
    expect(museRegistrationMatches({}, manifest())).toBe(false);
  });

  it("re-registers a plugin that is installed but not active", () => {
    expect(museRegistrationMatches(inspected({ active: false }), manifest())).toBe(false);
  });

  // Trust is keyed to the definition hash, so a changed manifest leaves the capability listed and
  // never started — which looks exactly like having the tools until one is called.
  it("re-registers when a capability is not trusted", () => {
    const untrusted = inspected();
    untrusted.runtime_capabilities[0] = { candidate: { capability_id: "render" }, status: "untrusted" };
    expect(museRegistrationMatches(untrusted, manifest())).toBe(false);
  });

  // The port and the bridge path live in the command, and a stale one points a session at a server
  // that is not listening — silently, because the bridge reads an unreachable resolve as "no
  // session" and serves an empty toolset.
  it("re-registers when the port has moved", () => {
    expect(museRegistrationMatches(inspected(), manifest(BRIDGE, 40000))).toBe(false);
  });

  it("re-registers when the bridge path has moved", () => {
    const moved = { command: "/usr/local/bin/node", args: ["/apps/mulmoterminal-2/server/mcp/bridge.mjs"] };
    expect(museRegistrationMatches(inspected(), manifest(moved))).toBe(false);
  });

  // A registration that declares fewer groups than we do is not ours either — it is an older
  // version of this plugin, from before a group existed.
  it("re-registers when a group is missing from muse's copy", () => {
    const partial = inspected();
    partial.plugin.capabilities.mcp_servers = partial.plugin.capabilities.mcp_servers.slice(1);
    partial.runtime_capabilities = partial.runtime_capabilities.slice(1);
    expect(museRegistrationMatches(partial, manifest())).toBe(false);
  });

  it("re-registers when muse reports no capabilities at all", () => {
    expect(museRegistrationMatches(inspected({ runtime_capabilities: [] }), manifest())).toBe(false);
  });
});

// A reattach comes through the sync too (see spawn-muse.ts), and one browser reload reattaches
// every cell on screen at once — so the check is throttled per process. Safe because the manifest
// is derived from this server's own bridge path and port, neither of which changes while it runs.
describe("syncMuseMcpPlugin's throttle", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mt-muse-ttl-"));
    vi.restoreAllMocks();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps retrying after a FAILED check, rather than starting the clock on it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const previous = process.env.MUSE_BIN;
    process.env.MUSE_BIN = path.join(dir, "no-such-muse");
    try {
      const { syncMuseMcpPlugin } = await import("../../../server/agents/muse-mcp.js");
      // Both fail, and the second is the assertion that matters: a throttle that started on a
      // failure would answer ok the second time and leave the user with no tools until a restart.
      expect(syncMuseMcpPlugin(dir, 1_000).ok).toBe(false);
      expect(syncMuseMcpPlugin(dir, 1_100).ok).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.MUSE_BIN;
      else process.env.MUSE_BIN = previous;
    }
  });
});

describe("syncMuseMcpPlugin", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mt-muse-sync-"));
    vi.restoreAllMocks();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // A muse that is not installed, a build with the flag gone, a read-only home: all of them are
  // reasons for a cell to have no GUI tools, and none of them a reason for the spawn to fail.
  it("answers rather than throws when the CLI is not there", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const previous = process.env.MUSE_BIN;
    process.env.MUSE_BIN = path.join(dir, "no-such-muse");
    try {
      const { syncMuseMcpPlugin } = await import("../../../server/agents/muse-mcp.js");
      expect(() => syncMuseMcpPlugin(dir)).not.toThrow();
      expect(syncMuseMcpPlugin(dir).ok).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.MUSE_BIN;
      else process.env.MUSE_BIN = previous;
    }
  });

  // A failed install records NOTHING that would make the next spawn skip its retry. There is no
  // such record left to get wrong now — the check reads muse — and this pins that it stays so.
  it("leaves nothing behind that would stop the next spawn retrying", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const previous = process.env.MUSE_BIN;
    process.env.MUSE_BIN = path.join(dir, "no-such-muse");
    mkdirSync(dir, { recursive: true });
    try {
      const { syncMuseMcpPlugin } = await import("../../../server/agents/muse-mcp.js");
      syncMuseMcpPlugin(dir);
      expect(syncMuseMcpPlugin(dir).ok).toBe(false);
      expect(existsSync(path.join(dir, ".installed"))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.MUSE_BIN;
      else process.env.MUSE_BIN = previous;
    }
  });
});
