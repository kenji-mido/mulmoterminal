import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { declaredGuiMcpServers, planGrokMcpSync, grokMcpConfigFile, grokMcpAddArgs, grokMcpRemoveArgs } from "../../../server/agents/grok-mcp.js";

const dirs: string[] = [];
const withConfig = (toml: string | null): string => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "grok-mcp-"));
  dirs.push(cwd);
  if (toml !== null) {
    mkdirSync(path.join(cwd, ".grok"), { recursive: true });
    writeFileSync(grokMcpConfigFile(cwd), toml, "utf8");
  }
  return cwd;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// The shape `grok mcp add -s project -t stdio -e …` really writes (grok 0.2.118).
const RENDER_ENTRY = `[mcp_servers.mulmoterminal-render]
command = "/usr/bin/node"
args = ["/app/bridge.mjs"]
enabled = true

[mcp_servers.mulmoterminal-render.env]
MULMOTERMINAL_TOOL_GROUP = "render"
`;

describe("declaredGuiMcpServers", () => {
  it("is empty for a directory with no grok config", () => {
    expect(declaredGuiMcpServers(grokMcpConfigFile(withConfig(null))).size).toBe(0);
  });

  it("finds the entries we wrote", () => {
    expect([...declaredGuiMcpServers(grokMcpConfigFile(withConfig(RENDER_ENTRY)))]).toEqual(["mulmoterminal-render"]);
  });

  // The restraint that matters: a server the USER registered is not ours and must never appear in
  // a removal list.
  it("ignores servers we do not own", () => {
    const cwd = withConfig(`[mcp_servers.playwright]\ncommand = "npx"\n\n${RENDER_ENTRY}`);
    expect([...declaredGuiMcpServers(grokMcpConfigFile(cwd))]).toEqual(["mulmoterminal-render"]);
  });
});

// The ordering bug this file exists to prevent a second time. `grok mcp add` ends in
// `<command> -- <args…>`, and EVERYTHING after the `--` is handed to the server being registered —
// so a `-s project` appended at the end never reaches grok, the add silently falls back to USER
// scope, and the entries land in `~/.grok/config.toml`, where every directory on the machine gets
// them. It exits 0 and writes nothing to the project file, so only looking at the file finds it.
describe("grok mcp argv", () => {
  const bridge = { command: "/usr/bin/node", args: ["/app/bridge.mjs"] };

  it("puts the scope before the command word, and the bridge args after the --", () => {
    expect(grokMcpAddArgs("mulmoterminal-render", "render", bridge)).toEqual([
      "add",
      "mulmoterminal-render",
      "-s",
      "project",
      "-t",
      "stdio",
      "-e",
      "MULMOTERMINAL_TOOL_GROUP=render",
      "/usr/bin/node",
      "--",
      "/app/bridge.mjs",
    ]);
  });

  it("never leaves the scope flag after the separator", () => {
    const args = grokMcpAddArgs("mulmoterminal-media", "media", bridge);
    expect(args.indexOf("-s")).toBeLessThan(args.indexOf("--"));
  });

  // `remove` without a scope searches EVERY scope, so an un-scoped remove could delete a
  // user-scope server someone registered themselves.
  it("scopes the removal too", () => {
    expect(grokMcpRemoveArgs("mulmoterminal-render")).toEqual(["remove", "mulmoterminal-render", "-s", "project"]);
  });
});

describe("planGrokMcpSync", () => {
  it("registers the groups a directory switched on", () => {
    expect(planGrokMcpSync(new Set(), ["render", "data"])).toEqual({ add: ["mulmoterminal-render", "mulmoterminal-data"], remove: [] });
  });

  it("does nothing when the file already says what it should", () => {
    expect(planGrokMcpSync(new Set(["mulmoterminal-render"]), ["render"])).toEqual({ add: [], remove: [] });
  });

  it("drops an entry for a group that was switched off", () => {
    expect(planGrokMcpSync(new Set(["mulmoterminal-render", "mulmoterminal-media"]), ["render"])).toEqual({
      add: [],
      remove: ["mulmoterminal-media"],
    });
  });

  it("clears everything for a directory with no groups", () => {
    expect(planGrokMcpSync(new Set(["mulmoterminal-render"]), [])).toEqual({ add: [], remove: ["mulmoterminal-render"] });
  });

  // An id we shipped once and no longer write. It is still ours to clean up, or it outlives the
  // code that made it — the same rule the antigravity path follows.
  it("removes a legacy id of ours", () => {
    expect(planGrokMcpSync(new Set(["mulmoterminal-gui"]), ["render"])).toEqual({
      add: ["mulmoterminal-render"],
      remove: ["mulmoterminal-gui"],
    });
  });
});
