// @vitest-environment node
// Who is recorded as carrying the whole GUI MCP, and what the group urls do about it.
//
// Removing `--strict-mcp-config` (#1338, #1385) is what lets a directory's own group registration
// and our all-tools url land on the SAME session. Both urls are ours, so the overlap is resolved on
// our side rather than by a CLI flag — but only if the answer is known before either client dials,
// which is why the claim happens at spawn rather than on first contact.
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import express from "express";
import request from "supertest";
import { makeTempDir } from "../../support/tempDir";

// Same reason as mcp-announce.spec.ts: the registry derives MULMOTERMINAL_HOME from the home
// directory at import time and PERSISTS what it learns, so HOME is pointed somewhere disposable
// before importing and put back afterwards (a worker is reused across spec files).
const HOME = makeTempDir("mt-full-gui-claim-");
const REAL_HOME = process.env.HOME;
process.env.HOME = HOME;
const { mountMcpRoutes } = await import("../../../server/routes/mcp-routes.js");
const { claimFullGuiMcp, hasAllGuiTools, releaseAllToolsSession, whenToolGroupsPersisted } = await import("../../../server/session/registry.js");
const { carriesFullGuiMcp } = await import("../../../server/session/mcp-config.js");
const { CLAUDE_CWD } = await import("../../../server/config/env.js");

afterAll(async () => {
  await whenToolGroupsPersisted();
  if (REAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = REAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

const app = express();
app.use(express.json());
mountMcpRoutes(app, { publish: () => {}, guiCallHistory: () => null });

const listTools = (route: string) =>
  request(app).post(route).set("accept", "application/json, text/event-stream").send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

// The route answers as SSE, so the JSON-RPC body arrives on a `data:` line.
function toolNamesFrom(text: string): string[] {
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  const payload: unknown = JSON.parse((line ?? "").replace(/^data:\s*/, ""));
  const tools = (payload as { result?: { tools?: { name: string }[] } }).result?.tools ?? [];
  return tools.map((t) => t.name);
}

describe("claimFullGuiMcp", () => {
  it("answers exactly what the pure predicate answers", () => {
    for (const [attach, cwd] of [
      [true, "/some/project"],
      [false, "/some/project"],
      [true, CLAUDE_CWD],
      [false, CLAUDE_CWD],
    ] as const) {
      expect(claimFullGuiMcp(randomUUID(), attach, cwd, false)).toBe(carriesFullGuiMcp(attach, cwd));
    }
  });

  it("records the session when it carries the full GUI MCP", () => {
    const id = randomUUID();
    expect(hasAllGuiTools(id)).toBe(false);
    claimFullGuiMcp(id, true, "/some/project", false);
    expect(hasAllGuiTools(id)).toBe(true);
  });

  // A project-directory cell reaches its GUI tools through the group urls its own directory
  // registered — marking it would switch exactly those off.
  it("records nothing for a cell that carries no GUI MCP of ours", () => {
    const id = randomUUID();
    claimFullGuiMcp(id, false, "/some/project", false);
    expect(hasAllGuiTools(id)).toBe(false);
  });

  // The half Codex found missing on the codex spawn path: a session id is reused across spawns, so
  // deciding "no" has to TAKE THE CLAIM BACK, not merely decline to add one.
  it("releases a claim the session no longer earns", () => {
    const id = randomUUID();
    claimFullGuiMcp(id, true, CLAUDE_CWD, false);
    expect(hasAllGuiTools(id)).toBe(true);
    claimFullGuiMcp(id, false, "/some/project", false);
    expect(hasAllGuiTools(id)).toBe(false);
  });

  // The two directions are deliberately not symmetric. A tmux reattach runs whatever the ORIGINAL
  // spawn was given, so claiming on top of it would assert a url this process may never have had —
  // the same stale-claim failure, reached from the other side.
  it("does not claim on a reattach", () => {
    const id = randomUUID();
    claimFullGuiMcp(id, true, CLAUDE_CWD, true);
    expect(hasAllGuiTools(id)).toBe(false);
  });

  // Releasing is unconditional, because the two mistakes do not cost the same: an over-release only
  // brings the duplicate tool names back and the next spawn corrects it, while a stale claim leaves
  // a cell with no GUI tools at all.
  it("releases even on a reattach", () => {
    const id = randomUUID();
    claimFullGuiMcp(id, true, CLAUDE_CWD, false);
    claimFullGuiMcp(id, false, "/some/project", true);
    expect(hasAllGuiTools(id)).toBe(false);
  });

  it("still answers the pure predicate on a reattach, whatever it records", () => {
    expect(claimFullGuiMcp(randomUUID(), true, CLAUDE_CWD, true)).toBe(true);
    expect(claimFullGuiMcp(randomUUID(), false, "/some/project", true)).toBe(false);
  });
});
// Nothing here asserts the id reaches disk. `markAllToolsSession` already persisted before this
// change and its append queue is private to the appender; what moved is only WHEN the mark is
// made, which the group-url cases below are what actually prove.

// A session id outlives the process that earned the claim: one opened in the single view (which
// takes the whole GUI MCP whatever its cwd) can be respawned as a project-directory grid cell. If
// the claim survived that, the new process would have its group urls stood down AND no all-tools
// url to fall back on — a cell with no GUI tools at all, which is worse than the duplicate the
// standing-down exists to prevent. spawn-claude releases it wherever it resets the tool groups.
describe("releaseAllToolsSession", () => {
  it("takes the claim back", () => {
    const id = randomUUID();
    claimFullGuiMcp(id, true, "/some/project", false);
    releaseAllToolsSession(id);
    expect(hasAllGuiTools(id)).toBe(false);
  });

  it("hands the group its tools back", async () => {
    const id = randomUUID();
    claimFullGuiMcp(id, true, "/some/project", false);
    expect(toolNamesFrom((await listTools(`/api/mcp/render/${id}`)).text)).toEqual([]);
    releaseAllToolsSession(id);
    expect(toolNamesFrom((await listTools(`/api/mcp/render/${id}`)).text).length).toBeGreaterThan(0);
  });

  it("is harmless on a session that never claimed", () => {
    const id = randomUUID();
    releaseAllToolsSession(id);
    expect(hasAllGuiTools(id)).toBe(false);
  });
});

describe("a group url once the session is claimed", () => {
  it("offers nothing, however early the group url connects", async () => {
    const id = randomUUID();
    // The order this spec exists for: the GROUP url is the first thing to reach us. Before the
    // claim moved to spawn, "does it have all tools" was learned from whichever url connected
    // first, so this call would have been served the full render group.
    claimFullGuiMcp(id, true, CLAUDE_CWD, false);
    expect(toolNamesFrom((await listTools(`/api/mcp/render/${id}`)).text)).toEqual([]);
  });

  it("still serves the group to a session that was never claimed", async () => {
    const id = randomUUID();
    expect(toolNamesFrom((await listTools(`/api/mcp/render/${id}`)).text).length).toBeGreaterThan(0);
  });

  // The failure a careless version of this would cause: the tools have to be somewhere. Standing
  // the group down is only correct because the all-tools url carries the same tools and more.
  it("leaves the all-tools url serving everything", async () => {
    const id = randomUUID();
    claimFullGuiMcp(id, true, CLAUDE_CWD, false);
    const all = toolNamesFrom((await listTools(`/api/mcp/${id}`)).text);
    const group = toolNamesFrom((await listTools(`/api/mcp/render/${randomUUID()}`)).text);
    expect(all.length).toBeGreaterThan(group.length);
    for (const name of group) expect(all).toContain(name);
  });
});
