# Per-route origin guards must exempt safe methods, like the central one does

Fixes #1094. 2026-07-30.

## Why

With `MULMOTERMINAL_HOST=0.0.0.0` + `MULMOTERMINAL_ALLOWED_ORIGINS=http://10.0.0.50:34567`, the
page loads, the terminals attach, every POST works — and exactly two GETs answer 403 forever:

```
api/remote-host/status:1  Failed to load resource: 403 (Forbidden)
api/google/status:1       Failed to load resource: 403 (Forbidden)
```

Three facts meet.

**A browser sends no `Origin` on a same-origin GET.** Fetch sets it for a non-GET/HEAD method or a
CORS-mode request; a plain same-origin GET carries nothing. The reporter's curl shows it exactly:
the request without the header is the browser's, and it is the one refused.

**`isAllowedOrigin` reads a missing Origin as "a non-browser caller"** (`infra/allowed-origin.ts`),
trustworthy only when the peer is loopback. That rule is right for what it was written for — a CLI
or MCP tool on this machine — and it cannot tell that caller apart from an honest browser two
metres away, because neither sends the header.

**The central gate already knows this and exempts safe methods** (`routes/same-origin-guard.ts`):
gating a GET by origin would not stop a cross-site `<img src=http://localhost:…>` (it sends no
Origin either) and would break the media loads that cannot send a header. So GET is deliberately
not judged.

The bug is that the exemption lives in the *middleware* rather than in the *rule*. Two routes keep
a guard of their own on top of the central one and call the predicate directly, so they never see
it. Every other per-route guard happens to sit on a POST, which is why only these two broke:

| call site | methods guarded | affected |
|---|---|---|
| `backends/remoteHost/routes.ts` | GET status, POST connect/reconnect/disconnect | **GET 403s** |
| `backends/google.ts` | GET status, POST authorize/unlink | **GET 403s** |
| `infra/tmux-routes.ts` (×2), `files/pick-file.ts`, `files/dirRequest.ts`, `git/worktree-routes.ts` (×4), `session/command-summary.ts` | POST only | no |
| `routes/ws-routes.ts`, `infra/pubsub.ts` | WebSocket upgrade | no |

WebSockets are unaffected because a browser always sends `Origin` on a handshake, and the socket.io
pub/sub is `transports: ["websocket"]`, so it never issues a polling GET.

MulmoClaude, the reference host, settles the shape: `server/api/csrfGuard.ts`'s `csrfVerdict` opens
with `if (SAFE_METHODS.has(method)) return ALLOW;` — before origin, before peer. Same rule, stated
where it cannot be bypassed.

## What

One helper, in the file that owns the rule, and every Express-side guard routed through it:

```ts
// routes/same-origin-guard.ts
export function requestOriginAllowed(req: Request, isAllowedOrigin: OriginPredicate): boolean {
  if (!needsSameOrigin(req.method, req.path)) return true;
  return isAllowedOrigin(req.headers.origin, req.socket?.remoteAddress);
}
```

`sameOriginGuard` is rewritten to call it too, so there is exactly one expression of the verdict.

The 11 per-route call sites, across 7 files, become `requestOriginAllowed(req, isAllowedOrigin)`.
Nine of them guard a POST and get the same boolean they computed before; the two that a GET reaches
(`remoteHost/routes.ts`'s `guard`, `google.ts`'s `forbidden`, each shared with that module's POSTs)
are the fix.

`ws-routes.ts` and `pubsub.ts` keep the direct call: a WS upgrade is a raw `IncomingMessage` with
no route and no method to exempt, and socket.io's CORS callback is handed no request at all.

## Why dropping the check on those GETs costs nothing

It never protected them:

- **A cross-site read was already impossible.** Neither route sends CORS headers, so a page on
  `evil.com` can issue the request but the browser refuses it the response. The origin check adds
  no confidentiality a same-origin policy was not already providing.
- **A non-browser caller was never stopped.** curl sets any header it likes, and the allowed origin
  is the server's own URL — the most guessable string in the setup. `curl -H "Origin: http://10.0.0.50:34567"`
  returns 200 today. The check was refusing the honest browser and nobody else.

Worth recording, and NOT changed here: `GET /api/remote-host/status` returns the session blob,
refresh token included (`remoteHost/session.ts`). That is reachable with the one-header curl above
both before and after this change, and a `0.0.0.0` bind already warns that anyone who can reach the
port can read the sessions. A GET that hands out a credential is still worth its own issue.

The reporter's other suggestion — accept `Sec-Fetch-Site: same-origin` when Origin is absent — is
not taken. A non-browser forges that header as easily as Origin, so it buys no defence, while
applying it inside `isAllowedOrigin` would weaken the POST and WebSocket paths that #548 hardened
(there, a missing Origin from a non-loopback peer must stay refused). It would also add a failure
mode on browsers that predate `Sec-Fetch-*`.

## Tests

- `same-origin-guard.spec.ts` — `requestOriginAllowed`: safe methods true even when the predicate
  refuses; POST follows the predicate; the view-data exemption still applies; the predicate is
  handed both origin and peer.
- `remoteHost/routes.spec.ts` — the existing "rejects a forbidden origin" case moves to POST
  /connect (still 403, still before the lifecycle); a new case pins GET /status answering 200 with
  a predicate that refuses everything.
- `backends/google.spec.ts` — same swap: GET /status leaves the 403 table and gains a 200 case.
- **New sweep**, `test/server/routes/per-route-origin-guard.spec.ts`, in the shape of
  `sendfile-dotfiles.spec.ts` (#954): no file under `server/` may READ the Origin header outside
  `same-origin-guard.ts`, `ws-routes.ts` and `pubsub.ts`. Forbidding the read rather than the call
  is what makes it hard to evade — a route has to read the header first however it then reaches
  the predicate, whereas a call-shaped pattern slips past a nested argument or a renamed
  parameter. That is what stops the next per-route GET guard from reopening this.

Four existing specs call a captured route handler directly with a hand-built request, and those
requests carried no `method` / `path` — which Express always sets and this guard now reads. Fixed
in the harness rather than at each call site: the fake `app.get/post` wraps the handler and fills
both in, the way Express does. `dirRequest.spec` builds its request itself, so it says `POST` there.

## Measured, against a real server

`MULMOTERMINAL_HOST=0.0.0.0 MULMOTERMINAL_ALLOWED_ORIGINS=http://192.168.11.6:34599`, curled over
the LAN interface (so the peer is not loopback — the reporter's setup) and over loopback. "before"
is this same server with the two guards reverted to the direct predicate call, so the two columns
differ only by that.

| peer | method | path | Origin sent | before | after |
|---|---|---|---|---|---|
| LAN | GET | `/api/remote-host/status` | none | **403** | **200** |
| LAN | GET | `/api/google/status` | none | **403** | **200** |
| LAN | GET | `/api/sessions` (no guard, the control) | none | 200 | 200 |
| LAN | GET | `/api/google/status` | named | 200 | 200 |
| LAN | POST | `/api/google/unlink` | none | 403 | 403 |
| LAN | POST | `/api/google/unlink` | `http://evil.example` | 403 | 403 |
| LAN | POST | `/api/remote-host/connect` | `http://evil.example` | 403 | 403 |
| LAN | POST | `/api/tmux/cleanup-orphans` | `http://evil.example` | 403 | 403 |
| LAN | POST | `/api/google/unlink` | named | 200 | 200 |
| loopback | GET | both status routes | none | 200 | 200 |
| loopback | POST | `/api/google/unlink` | none | 200 | 200 |
| loopback | POST | `/api/google/unlink` | `http://evil.example` | 403 | 403 |

The control row is the point: an unguarded GET already answered a LAN browser, so the two that
refused were the outliers, not the rule. Everything a POST or a foreign origin could do before, it
still does — including the row that matters most for #548, a POST with no Origin from a
non-loopback peer, still 403.

## Docs

`docs/guide/{en,ja}` describes `MULMOTERMINAL_ALLOWED_ORIGINS` for the LAN setup; the symptom this
fixes ("the page loads but the console fills with 403") is what a reader hits, so the LAN section
gets a line saying which versions had it.
