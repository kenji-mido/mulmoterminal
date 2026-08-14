// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mintViewToken,
  verifyViewToken,
  clampCapabilities,
  requireViewToken,
  VIEW_TOKEN_TTL_MS,
  type ViewCapability,
} from "../../../server/backends/viewToken.js";
import type { Request, Response, NextFunction } from "express";
import { initProjectRoots, projectId, resetProjectRootsForTesting } from "../../../server/infra/project-root.js";

// The middleware checks the token's root against the one the REQUEST resolves, so these tests
// need a bound workspace. `/ws` is the root every token below is minted for.
const WS = "/ws";
const OTHER = "/other-project";

describe("viewToken mint/verify", () => {
  it("round-trips a minted token", () => {
    const { token, exp } = mintViewToken("watchlist", ["read"], projectId(WS), 1000);
    expect(exp).toBe(1000 + VIEW_TOKEN_TTL_MS);
    const payload = verifyViewToken(token, 2000);
    expect(payload).toEqual({ slug: "watchlist", project: projectId(WS), caps: ["read"], exp: 1000 + VIEW_TOKEN_TTL_MS });
  });

  it("rejects a tampered payload", () => {
    const { token } = mintViewToken("watchlist", ["read"], projectId(WS), 1000);
    const [payloadB64, sig] = token.split(".");
    // Re-encode a payload claiming a different slug, keep the original signature.
    const forged = Buffer.from(JSON.stringify({ slug: "secrets", caps: ["read", "write"], exp: 1000 + VIEW_TOKEN_TTL_MS }), "utf8").toString("base64url");
    expect(verifyViewToken(`${forged}.${sig}`, 2000)).toBeNull();
    // Sanity: the untouched token still verifies.
    expect(verifyViewToken(`${payloadB64}.${sig}`, 2000)).not.toBeNull();
  });

  it("rejects a bad signature", () => {
    const { token } = mintViewToken("watchlist", ["read"], projectId(WS), 1000);
    const [payloadB64] = token.split(".");
    expect(verifyViewToken(`${payloadB64}.deadbeef`, 2000)).toBeNull();
  });

  it("rejects an expired token", () => {
    const { token, exp } = mintViewToken("watchlist", ["read"], projectId(WS), 1000);
    expect(verifyViewToken(token, exp)).toBeNull(); // exactly at exp → expired
    expect(verifyViewToken(token, exp + 1)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifyViewToken("")).toBeNull();
    expect(verifyViewToken("nodot")).toBeNull();
    expect(verifyViewToken(".onlysig")).toBeNull();
  });
});

describe("clampCapabilities", () => {
  const cases: Array<[ViewCapability[] | undefined, ViewCapability[] | undefined, ViewCapability[]]> = [
    [["read", "write"], ["read"], ["read"]], // requested narrows the declared set
    [["read"], ["read", "write"], ["read"]], // declared caps the grant (no write escalation)
    [undefined, undefined, ["read"]], // least-privilege default
    [["read", "write"], undefined, ["read", "write"]], // undefined requested ⇒ full declared set
    [[], ["read"], ["read"]], // empty declared ⇒ default ["read"]
  ];
  it.each(cases)("clamp(%j, %j) → %j", (declared, requested, expected) => {
    expect(clampCapabilities(declared, requested)).toEqual(expected);
  });
});

interface MockRes {
  statusCode: number;
  body: unknown;
  status(code: number): MockRes;
  json(b: unknown): MockRes;
}
function mockRes(): MockRes {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

function runGuard(action: ViewCapability, headers: Record<string, string>, slug: string, query: Record<string, unknown> = {}) {
  const res = mockRes();
  const next = vi.fn();
  requireViewToken(action)({ headers, params: { slug }, query } as unknown as Request, res as unknown as Response, next as NextFunction);
  return { res, next };
}

describe("requireViewToken middleware", () => {
  beforeEach(() => {
    resetProjectRootsForTesting();
    initProjectRoots({ workspace: WS, knownProjects: () => [{ label: "other", path: OTHER }] });
  });

  it("401s with no Authorization header", () => {
    const { res, next } = runGuard("read", {}, "watchlist");
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() for a valid token with the right slug + capability", () => {
    const { token } = mintViewToken("watchlist", ["read"], projectId(WS));
    const { res, next } = runGuard("read", { authorization: `Bearer ${token}` }, "watchlist");
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it("401s when the token's slug differs from the route", () => {
    const { token } = mintViewToken("watchlist", ["read"], projectId(WS));
    const { res, next } = runGuard("read", { authorization: `Bearer ${token}` }, "other");
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  // The token is scoped to a ROOT as well as a slug. A slug is unique only within a root, so
  // without this a `tasks` token minted in one project would read `tasks` in another.
  it("401s when the request names a different project than the token", () => {
    const { token } = mintViewToken("watchlist", ["read"], projectId(WS));
    const { res, next } = runGuard("read", { authorization: `Bearer ${token}` }, "watchlist", { project: projectId(OTHER) });
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when the request names the project the token was minted for", () => {
    const { token } = mintViewToken("watchlist", ["read"], projectId(OTHER));
    const { res, next } = runGuard("read", { authorization: `Bearer ${token}` }, "watchlist", { project: projectId(OTHER) });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  // An unresolvable project has no valid token by definition — the refusal must not surface as
  // a 500 from inside auth middleware.
  it("401s when the TOKEN names a project the server can no longer resolve", () => {
    const { token } = mintViewToken("watchlist", ["read"], "0123456789abcdef");
    const { res, next } = runGuard("read", { authorization: `Bearer ${token}` }, "watchlist");
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("401s when the required capability is missing", () => {
    const { token } = mintViewToken("watchlist", ["read"], projectId(WS));
    const { res, next } = runGuard("write", { authorization: `Bearer ${token}` }, "watchlist");
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
