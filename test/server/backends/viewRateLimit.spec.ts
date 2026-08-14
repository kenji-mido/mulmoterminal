// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { makeViewActionRateLimiter, ONE_MINUTE_MS } from "../../../server/backends/viewRateLimit.js";

// Minimal express stand-ins: the limiter only reads req.ip / req.params.slug and
// only ever calls res.status().json() on refusal, so driving it directly is both
// exact and free of an HTTP round trip.
const reqFor = (ip: string, slug: string) => ({ ip, params: { slug } }) as unknown as Request<{ slug?: string }>;

function resSpy() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { res: { status } as unknown as Response, status, json };
}

describe("makeViewActionRateLimiter", () => {
  it("passes requests up to the budget, then 429s", () => {
    const limit = makeViewActionRateLimiter(3, ONE_MINUTE_MS, () => 1000);
    const next = vi.fn();
    const { res, status } = resSpy();
    for (let i = 0; i < 3; i += 1) limit(reqFor("client-a", "col"), res, next);
    expect(next).toHaveBeenCalledTimes(3);
    limit(reqFor("client-a", "col"), res, next);
    expect(next).toHaveBeenCalledTimes(3);
    expect(status).toHaveBeenCalledWith(429);
  });

  it("keys by IP AND slug, so one view's burst can't starve another", () => {
    const limit = makeViewActionRateLimiter(1, ONE_MINUTE_MS, () => 1000);
    const next = vi.fn();
    const { res, status } = resSpy();
    limit(reqFor("client-a", "colA"), res, next);
    limit(reqFor("client-a", "colB"), res, next); // different slug — own bucket
    limit(reqFor("client-b", "colA"), res, next); // different IP — own bucket
    expect(next).toHaveBeenCalledTimes(3);
    expect(status).not.toHaveBeenCalled();
  });

  it("starts a fresh window once the old one has elapsed", () => {
    let now = 1000;
    const limit = makeViewActionRateLimiter(1, ONE_MINUTE_MS, () => now);
    const next = vi.fn();
    const { res, status } = resSpy();
    limit(reqFor("client-a", "col"), res, next);
    limit(reqFor("client-a", "col"), res, next);
    expect(status).toHaveBeenCalledWith(429);
    now += ONE_MINUTE_MS + 1;
    limit(reqFor("client-a", "col"), res, next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
