// Scoped capability tokens for custom collection views — MulmoTerminal's port of
// MulmoClaude's server/api/auth/viewToken.ts.
//
// A custom view is LLM-authored HTML rendered in a sandboxed (allow-scripts,
// opaque-origin) iframe. It must reach ONLY its collection's view-data endpoint,
// for one slug, with an explicit capability set (read/write). The authenticated
// parent mints a short-lived signed token (`base64url(payload).HMAC`); the iframe
// sends it as `Authorization: Bearer <token>`; `requireViewToken` verifies it.
//
// MulmoTerminal has no global bearer auth (loopback tool), so — unlike MulmoClaude,
// which keys the HMAC by its per-startup bearer token — we generate a per-PROCESS
// random signing key here. A restart invalidates outstanding view tokens (the key
// changes), the same lifecycle MulmoClaude gets for free.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { isRecord } from "../../common/isRecord.js";
import { attachProjectScope, rootForProjectId } from "../infra/project-root.js";

export type ViewCapability = "read" | "write";

export function isCapability(value: unknown): value is ViewCapability {
  return value === "read" || value === "write";
}

const ONE_HOUR_MS = 60 * 60 * 1000;
/** How long a minted view token stays valid. The parent re-mints on each render. */
export const VIEW_TOKEN_TTL_MS = ONE_HOUR_MS;

const BEARER_PREFIX = "Bearer ";

// Per-process signing key — generated once, lost on restart (intentional).
const SIGNING_KEY = randomBytes(32).toString("hex");

interface ViewTokenPayload {
  slug: string;
  /** The project the token was minted for, as its OPAQUE ID. A slug is unique only within a
   *  root, so without this a token for `tasks` in one project would read `tasks` in another.
   *
   *  The id, never the path: a token is signed but NOT encrypted — everything before the dot
   *  is plain base64url JSON — and it is handed to an LLM-authored iframe. An absolute root
   *  here would publish the user's home directory to exactly the party the opaque id exists to
   *  keep it from. */
  project: string;
  caps: ViewCapability[];
  exp: number;
}

function signPayload(payloadB64: string): string {
  return createHmac("sha256", SIGNING_KEY).update(payloadB64).digest("base64url");
}

// Least privilege when a view declares nothing. A module constant rather than a literal cast
// at the call site: an annotation is checked, an assertion is not.
const LEAST_PRIVILEGE: ViewCapability[] = ["read"];

/** Clamp a view's requested capabilities to what it declared in its schema — a
 *  `["read"]` view can never get a `write` token. The result is declared ∩
 *  requested; undefined declared ⇒ least-privilege `["read"]`. */
export function clampCapabilities(declared: ViewCapability[] | undefined, requested: ViewCapability[] | undefined): ViewCapability[] {
  const declaredCaps = declared && declared.length > 0 ? declared : LEAST_PRIVILEGE;
  const requestedCaps = requested && requested.length > 0 ? requested : declaredCaps;
  return declaredCaps.filter((cap) => requestedCaps.includes(cap));
}

/** Mint a signed token for `slug` granting `caps`, valid for {@link VIEW_TOKEN_TTL_MS}. */
export function mintViewToken(slug: string, caps: ViewCapability[], project: string, nowMs: number = Date.now()): { token: string; exp: number } {
  const exp = nowMs + VIEW_TOKEN_TTL_MS;
  const payload: ViewTokenPayload = { slug, project, caps, exp };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { token: `${payloadB64}.${signPayload(payloadB64)}`, exp };
}

/** Verify a token's signature + expiry; return its payload or null on any failure. */
export function verifyViewToken(token: string, nowMs: number = Date.now()): ViewTokenPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot >= token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  const expectedSig = signPayload(payloadB64);
  // Compare byte lengths before timingSafeEqual — it throws on a length mismatch.
  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(providedBuf, expectedBuf)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const { slug, project, exp, caps } = parsed;
  if (typeof slug !== "string" || typeof project !== "string" || typeof exp !== "number") return null;
  // `every` with a type predicate narrows the array itself, so the checked value IS the typed one.
  if (!Array.isArray(caps) || !caps.every(isCapability)) return null;
  if (nowMs >= exp) return null;
  return { slug, project, caps, exp };
}

/** Express middleware: require a valid scoped token whose slug matches the route
 *  param and whose caps include `action`. 401 on any failure. */
export function requireViewToken(action: ViewCapability) {
  return function requireViewTokenMiddleware(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const payload = verifyViewToken(header.slice(BEARER_PREFIX.length));
    if (!payload || payload.slug !== req.params.slug || !payload.caps.includes(action)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    // The TOKEN names the project, not the URL. The iframe builds its other endpoints by
    // concatenating onto the data URL (`dataUrl + "/query"`), so a query parameter there would
    // end up inside the suffix; carrying the project in the token keeps those URLs clean and
    // makes authorization and scope one decision instead of two that can disagree.
    const root = rootForProjectId(payload.project);
    if (root === null) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    // A request that ALSO names a project must name the same one. Ignoring a mismatch would
    // serve the token's project while the URL asked for another.
    if (Object.hasOwn(req.query, "project") && req.query.project !== payload.project) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    attachProjectScope(req, { workspaceRoot: root });
    next();
  };
}
