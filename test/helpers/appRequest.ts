// Call an Express app the way a browser would, without a socket.
//
// The specs that pin a route used to hand-roll a server per file — `app.listen(0)` in a
// `beforeAll`, the port read back off `server.address()`, `fetch` against `127.0.0.1`, a
// `close()` in `afterAll`. Every assertion then rode a real TCP round trip, and a round trip
// needs the event loop to turn several times for work that is otherwise pure. Under a loaded
// runner that is what crosses `testTimeout` first: in #1314 the SAME file's six lexical tests
// passed while four of its five route tests failed, in one process, in one instant.
//
// `inject` runs the same request through the same handler chain — real `express.json()`, real
// routing, real `res.status().json()` — over an in-memory socket, so a route spec costs what a
// function call costs. What it cannot do is answer a request from ANOTHER process; a spec that
// spawns one (test/server/mcp/bridge.spec.ts) still needs a listening server.
import inject from "light-my-request";
import type { InjectOptions } from "light-my-request";
import type { Express } from "express";

/** What a spec may vary per call. `body` is sent as-is — a string for JSON (the route decides
 *  how to read it), bytes for an upload. `headers` are the request's own; nothing is implied.
 *  The method list is `inject`'s own, so a typo is a type error rather than a 404. */
export type AppRequestInit = {
  method?: InjectOptions["method"];
  headers?: Record<string, string>;
  body?: string | Buffer;
};

// A response with a body where the spec says there is none is a TypeError from the Response
// constructor, not a failed assertion — so the statuses that forbid one are answered with null.
//
// Only these three: `Response` refuses a status outside 200-599 outright, so an informational
// 1xx cannot be carried here at all and listing one would just move the throw. Nothing reachable
// through `app` answers 1xx — an upgrade never goes through the express handler chain.
const BODYLESS_STATUSES = new Set([204, 205, 304]);

// `inject` reports headers the way Node does: one string, a number, or a LIST for the names a
// response may repeat (`set-cookie`). `append` keeps every value; `set` would keep the last.
const toHeaders = (raw: Record<string, string | string[] | number | undefined>): Headers => {
  const headers = new Headers();
  Object.entries(raw).forEach(([name, value]) => {
    if (Array.isArray(value)) value.forEach((one) => headers.append(name, one));
    else if (value !== undefined) headers.set(name, String(value));
  });
  return headers;
};

/**
 * A `fetch`-shaped caller bound to `app`: `const call = appRequest(app)` then
 * `await call("/api/wiki?slug=alpha")`. The answer is a real `Response`, so `status`,
 * `headers.get()`, `json()`, `text()` and `arrayBuffer()` read exactly as they did when
 * these specs went over the wire.
 */
export function appRequest(app: Express) {
  return async (url: string, init: AppRequestInit = {}): Promise<Response> => {
    // Spread rather than assign: `exactOptionalPropertyTypes` makes an explicit `undefined`
    // a different thing from an absent key, and `inject` wants the key absent.
    const res = await inject(app, {
      method: init.method ?? "GET",
      url,
      ...(init.headers ? { headers: init.headers } : {}),
      ...(init.body === undefined ? {} : { payload: init.body }),
    });
    const body = BODYLESS_STATUSES.has(res.statusCode) ? null : res.rawPayload;
    return new Response(body, { status: res.statusCode, headers: toHeaders(res.headers) });
  };
}
