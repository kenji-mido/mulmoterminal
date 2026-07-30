import type { NextFunction, Request, Response } from "express";

// A single same-origin gate for every state-changing request, instead of each route
// remembering to ask.
//
// Why it is needed even though the server binds to loopback: loopback is reachable from the
// user's OWN browser, so a site they happen to visit can POST to http://localhost:34567. It
// cannot READ the reply cross-origin, but the side effect still happens — and among these
// routes are ones that spawn an agent, rewrite the config, and write files. Per-route guards
// covered some of that surface and not the rest, which is the failure mode a central gate
// removes: a route added tomorrow is covered by default rather than by memory.
//
// Safe methods are left alone — but not because they are guaranteed side-effect free. Gating
// them by origin would achieve nothing: a cross-site `<img src=http://localhost:.../>` sends NO
// Origin header, exactly like a legitimate local fetch, so the predicate cannot tell them
// apart. It would only break the media loads that cannot send a header.
//
// That makes "a GET must not change anything" a rule this file relies on and cannot enforce.
// One route already bends it: GET /api/session/:id calls freshenRosterTitle, which may spawn
// an LLM title generation. It is rate-limited and needs a server-generated session UUID the
// caller would have to know, so the cost of the bend is small — but a NEW side effect added to
// a GET is unprotected by anything here, and belongs in a POST.
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// The one deliberate cross-origin caller: a custom collection view is LLM-authored HTML in a
// sandboxed iframe, so its origin is opaque (`null`) by construction. It carries its own
// HMAC-signed capability token, scoped to one slug and to read/write — a stronger check than
// origin, and the reason these paths must not be judged by origin at all.
const VIEW_DATA = /^\/api\/collections\/[^/]+\/view-data(\/|$)/;

type OriginPredicate = (origin: string | undefined, remoteAddress: string | undefined) => boolean;

export function needsSameOrigin(method: string, path: string): boolean {
  if (!STATE_CHANGING.has(method.toUpperCase())) return false;
  return !VIEW_DATA.test(path);
}

// The same verdict for a route that keeps a guard of its own on top of the gate below — which is
// most of the local-action routes, deliberately: the gate is the floor, not a replacement.
//
// It exists because the safe-method exemption belongs to the RULE and not to the middleware. A
// per-route guard that asked the predicate directly lost it, and a browser sends NO Origin on a
// same-origin GET — so those routes refused every page served from an origin the operator had
// just named, which is #1094. Two of them guarded a GET; the rest happened to sit on a POST,
// where this returns exactly what the direct call did.
export function requestOriginAllowed(req: Request, isAllowedOrigin: OriginPredicate): boolean {
  if (!needsSameOrigin(req.method, req.path)) return true;
  return isAllowedOrigin(req.headers.origin, req.socket?.remoteAddress);
}

export function sameOriginGuard(isAllowedOrigin: OriginPredicate) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (requestOriginAllowed(req, isAllowedOrigin)) return next();
    res.status(403).json({ error: "forbidden origin" });
  };
}
