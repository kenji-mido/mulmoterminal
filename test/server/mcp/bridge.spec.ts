// @vitest-environment node
//
// The bridge is spawned for real (it is a plain .mjs run by node, which is the point — the
// version before it needed `tsx` resolved from the CHILD's cwd and died in every project but
// this one), and answered by a stub HTTP server standing in for the GUI MCP route.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../server/mcp/bridge.mjs");
const SESSION = "11111111-2222-3333-4444-555555555555";

describe("mcp bridge", () => {
  let server: http.Server;
  let port: number;
  let requests: { url: string; body: string }[];
  let status = 200;
  // What /api/mcp-resolve answers — the muse path, where the bridge is told nothing and asks.
  let resolve: { sessionId: string | null; groups: string[] } = { sessionId: null, groups: [] };

  beforeEach(async () => {
    requests = [];
    status = 200;
    resolve = { sessionId: null, groups: [] };
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        requests.push({ url: req.url ?? "", body });
        if (req.url === "/api/mcp-resolve") {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify(resolve));
        }
        if (status !== 200) return res.writeHead(status).end();
        const id = JSON.parse(body || "{}").id;
        if (id === undefined) return res.writeHead(202).end(); // a notification
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result: { ok: true } })}\n\n`);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  // Runs from a directory that is NOT this package, so a bridge needing anything resolved from
  // its cwd would fail here the way it failed for a user.
  async function run(lines: string[], env: Record<string, string> = {}, args: string[] = []): Promise<string> {
    const proc = spawn(process.execPath, [bridge, ...args], {
      cwd: path.parse(process.cwd()).root,
      env: { ...process.env, MULMOTERMINAL_PORT: String(port), MULMOTERMINAL_SESSION_ID: SESSION, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    for (const line of lines) proc.stdin.write(line + "\n");
    proc.stdin.end();
    await new Promise((resolve) => proc.on("exit", resolve));
    return out;
  }

  // The muse shape: NOTHING in the environment, everything in argv. `env: {}` would still inherit
  // this process's own MULMOTERMINAL_* if any were set, so they are cleared explicitly.
  async function runBare(lines: string[], args: string[]): Promise<string> {
    return run(lines, { MULMOTERMINAL_PORT: "", MULMOTERMINAL_SESSION_ID: "", MULMOTERMINAL_TOOL_GROUP: "" }, args);
  }

  it("forwards a request to the session's group URL and returns the SSE payload", async () => {
    const out = await run([JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })], { MULMOTERMINAL_TOOL_GROUP: "render" });
    expect(requests[0].url).toBe(`/api/mcp/render/${SESSION}`);
    expect(JSON.parse(out.trim())).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
  });

  it("says nothing back for a notification", async () => {
    expect(await run([JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })])).toBe("");
  });

  // An unanswered request leaves the agent reporting "still connecting" for the life of the
  // session instead of an error, which is how the first version of this failed.
  it("answers an HTTP failure with a JSON-RPC error", async () => {
    status = 500;
    const out = await run([JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" })]);
    expect(JSON.parse(out.trim())).toMatchObject({ id: 7, error: { code: -32603 } });
  });

  it("answers with an error rather than hanging when there is no session", async () => {
    const out = await run([JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" })], { MULMOTERMINAL_SESSION_ID: "" });
    expect(JSON.parse(out.trim())).toMatchObject({ id: 9, error: { code: -32603 } });
    expect(requests).toHaveLength(0);
  });

  // muse's half. Its registration is a PLUGIN, installed once for the machine and started with a
  // curated environment that carries NOTHING of ours (measured: 16 variables, all muse's own). So
  // the group and the port arrive as argv, and the session is asked for — /api/mcp-resolve maps the
  // bridge's own pid back to the session whose pane it runs under.
  describe("the group and port in argv, and the session resolved over HTTP", () => {
    const list = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    it("takes the group from --group and the port from --port, with no environment at all", async () => {
      resolve = { sessionId: SESSION, groups: ["data"] };
      const out = await runBare([list], ["--group", "data", "--port", String(port)]);
      expect(requests.find((r) => r.url.startsWith("/api/mcp/data/"))?.url).toBe(`/api/mcp/data/${SESSION}`);
      expect(JSON.parse(out.trim())).toMatchObject({ id: 1, result: { ok: true } });
    });

    it("asks the resolve route who it is serving, with its own pid and cwd", async () => {
      resolve = { sessionId: SESSION, groups: ["render"] };
      await runBare([list], ["--group", "render", "--port", String(port)]);
      const asked = requests.find((r) => r.url === "/api/mcp-resolve");
      expect(asked).toBeTruthy();
      expect(JSON.parse(asked?.body ?? "{}")).toMatchObject({ pid: expect.any(Number), cwd: expect.any(String) });
    });

    // The one that keeps a directory's switches meaningful for muse: every group is registered for
    // the machine, so a session that switched on `render` alone must see nothing from the rest.
    it("serves an EMPTY toolset for a group this session is not entitled to", async () => {
      resolve = { sessionId: SESSION, groups: ["render"] };
      const out = await runBare([list], ["--group", "media", "--port", String(port)]);
      expect(JSON.parse(out.trim())).toEqual({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
      expect(requests.some((r) => r.url.startsWith("/api/mcp/media/"))).toBe(false);
    });

    // A muse someone started in a plain terminal has the plugin and no session. Empty tools, not a
    // broken server: muse starts all four, and three failures read as a bug in the app.
    it("stands down when no session owns the process", async () => {
      resolve = { sessionId: null, groups: [] };
      const out = await runBare([JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize" })], ["--group", "render", "--port", String(port)]);
      expect(JSON.parse(out.trim())).toMatchObject({ id: 2, result: { capabilities: { tools: {} } } });
    });

    it("answers a call it cannot serve with an error rather than silence", async () => {
      resolve = { sessionId: null, groups: [] };
      const out = await runBare(
        [JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "presentChart" } })],
        ["--group", "render", "--port", String(port)],
      );
      expect(JSON.parse(out.trim())).toMatchObject({ id: 3, error: { code: -32603 } });
    });

    // Resolution is per PROCESS, not per call: the session cannot change under a running bridge,
    // and this is on the path of every tool call.
    it("resolves once and reuses the answer", async () => {
      resolve = { sessionId: SESSION, groups: ["render"] };
      await runBare([list, list, list], ["--group", "render", "--port", String(port)]);
      expect(requests.filter((r) => r.url === "/api/mcp-resolve")).toHaveLength(1);
    });

    // The env path is still the one agy and grok take, and it must not start asking.
    it("never resolves when the environment already names the session", async () => {
      await run([list], { MULMOTERMINAL_TOOL_GROUP: "render" });
      expect(requests.some((r) => r.url === "/api/mcp-resolve")).toBe(false);
    });
  });
});
