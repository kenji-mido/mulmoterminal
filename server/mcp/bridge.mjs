// A stdio MCP server that forwards to this server's in-process GUI MCP over HTTP.
//
// claude and codex are handed a per-session URL at spawn (`--mcp-config`, `-c mcp_servers.…`),
// so nothing like this is needed for them. `agy` takes no such flag: it reads MCP servers from
// a FILE, and the only file it reads per project is `.agents/mcp_config.json` — one per
// DIRECTORY, shared by every session running there. So the session id cannot ride in the URL.
// It rides the agy process's environment instead (guiMcpEnv, set per spawn), and this bridge —
// which agy spawns as a child of that process — reads it from there.
//
// Plain .mjs, not TypeScript: node resolves a bare `--import tsx` against the CHILD's cwd, which
// is the user's project and has no tsx. Nothing here needs compiling, so nothing does.
import { createInterface } from "node:readline";

// TWO WAYS IN, because the hosts differ in what they can hand a child process.
//
//   agy and grok write the group into the server entry's own `env` block, and the SESSION reaches
//   this process by inheritance: the bridge is a child of the agent, which was spawned with
//   guiMcpEnv. One shared config file therefore serves every session in a directory.
//
//   muse hands over NOTHING. Its registration is a plugin, and a plugin's MCP server is started
//   with a curated environment — measured at 16 variables, all muse's own — so neither the muse
//   process's environment nor the manifest's own `env` block arrives here. What is ours is the
//   COMMAND LINE, so the group and the port come in as `--group` and `--port`, and the session is
//   asked for: /api/mcp-resolve maps this process's own pid back to the session whose pane — or
//   whose pty — it is running under (server/session/bridge-session.ts). NOT `/api/mcp/resolve`:
//   that path is one segment and `/api/mcp/:sessionId` answers it with a 400.
const argv = process.argv.slice(2);
const flag = (name) => (argv.indexOf(name) >= 0 ? argv[argv.indexOf(name) + 1] : undefined);
const port = flag("--port") || process.env.MULMOTERMINAL_PORT;
const group = flag("--group") || process.env.MULMOTERMINAL_TOOL_GROUP;
const envSessionId = process.env.MULMOTERMINAL_SESSION_ID;

// The group is encoded into the URL path, so a value carrying `/` or `..` must not steer the
// request somewhere other than the tool-group route it names; the port is needed to build one at
// all. The SESSION is not checked here — it may still be resolved below.
let missing = null;
if (!group) missing = "the tool group";
else if (!port) missing = "the mulmoterminal port";

const origin = `http://127.0.0.1:${port}`;
const groupUrl = (session) => `${origin}/api/mcp/${encodeURIComponent(group)}/${encodeURIComponent(session)}`;

/**
 * Who this bridge is serving, and what that session may reach.
 *
 * Asked ONCE and remembered: a session cannot change under a running bridge — the bridge dies with
 * the agent process that started it — and this is on the path of every tool call.
 *
 * A session that cannot be resolved is not an error. A muse the user started in a plain terminal
 * has a plugin registration and no session, and the honest answer there is a server with no tools
 * rather than a broken one.
 */
// The PROMISE is cached, not its result. Requests arrive on a line reader and are handled
// concurrently, so caching the answer still lets the first few calls of a session each start their
// own resolve — three tools/list at once asked three times (caught by the spec).
let resolving = null;
function session() {
  if (envSessionId) return Promise.resolve({ sessionId: envSessionId, groups: null });
  resolving ??= (async () => {
    try {
      const res = await fetch(`${origin}/api/mcp-resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pid: process.pid, cwd: process.cwd() }),
      });
      const body = res.ok ? await res.json() : {};
      return { sessionId: body.sessionId ?? null, groups: Array.isArray(body.groups) ? body.groups : [] };
    } catch {
      return { sessionId: null, groups: [] };
    }
  })();
  return resolving;
}

// Which groups THIS SESSION may reach. `null` means the host did not say — agy and grok are already
// narrowed by the config file they read, and adding an opinion here would withhold their tools.
const entitled = (groups) => groups === null || groups.includes(group);

const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");

// An id means a RESPONSE is owed; without one the message is a notification, and silence is the
// correct answer even when it failed. Every failure path answers, because an unanswered request
// leaves agy reporting "still connecting" for the life of the session rather than an error.
const fail = (id, message) => {
  if (id !== undefined && id !== null) send({ jsonrpc: "2.0", id, error: { code: -32603, message } });
};

// The server replies as SSE (`data: {…}` lines) or as plain JSON, and with an empty 202 for a
// notification — which yields nothing to forward, correctly.
function responses(body) {
  const trimmed = body.trim();
  if (trimmed === "") return [];
  if (trimmed.startsWith("{")) return [trimmed];
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6).trim())
    .filter(Boolean);
}

// A session that cannot be resolved, or a group it is not entitled to, answers as a HEALTHY server
// with no tools rather than as an error. The distinction matters because muse starts all four of
// them for every session: erroring would show three broken servers in a session that switched one
// group on, which reads as a bug in the app. An empty toolset reads as what it is.
function standDown(id, method, reason) {
  if (id === undefined || id === null) return;
  if (method === "initialize")
    return send({
      jsonrpc: "2.0",
      id,
      result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: `mulmoterminal-${group}`, version: "0" } },
    });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: [] } });
  return fail(id, `mulmoterminal: ${reason}`);
}

createInterface({ input: process.stdin, terminal: false }).on("line", async (line) => {
  if (line.trim() === "") return;
  let id;
  try {
    const message = JSON.parse(line);
    id = message.id;
    if (missing) return fail(id, `mulmoterminal: ${missing} is not set — this MCP server only runs inside a mulmoterminal session`);

    const { sessionId, groups } = await session();
    if (!sessionId) return standDown(id, message.method, "no mulmoterminal session owns this process");
    if (!entitled(groups)) return standDown(id, message.method, `the ${group} tools are not switched on for this session`);

    const res = await fetch(groupUrl(sessionId), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: line,
    });
    if (!res.ok) return fail(id, `mulmoterminal returned HTTP ${res.status}`);
    for (const response of responses(await res.text())) process.stdout.write(response + "\n");
  } catch (err) {
    fail(id, `mulmoterminal is unreachable: ${err}`);
  }
});
