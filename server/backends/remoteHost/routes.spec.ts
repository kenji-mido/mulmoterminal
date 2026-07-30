import { describe, it, expect, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import type { RemoteHostLifecycle, RemoteHostStatus } from "@mulmoclaude/core/remote-host/server";
import { mountRemoteHostRoutes, type RemoteHostRouteDeps } from "./routes.js";
import type { RunnerHealth } from "../../../common/remoteHostHealth.js";

const CONNECTED: RemoteHostStatus = { connected: true, uid: "u1" };
const DISCONNECTED: RemoteHostStatus = { connected: false, uid: null };
const SESSION_BLOB = "blob-current";
const ONLINE: RunnerHealth = { state: "online", lastError: null, changedAt: 100 };
// What a disconnected lifecycle reports whatever the last live reading was.
const OFFLINE: RunnerHealth = { ...ONLINE, state: "offline" };

// A sentinel "expired blob" error the injected reconnectErrorStatus maps to 401 (the
// real one is `instanceof RemoteHostSessionExpiredError`; here we test the ROUTE's use
// of the mapping, not the mapping itself — that's session.spec.ts).
class ExpiredError extends Error {}

const fakeLifecycle = (over: Partial<RemoteHostLifecycle> = {}): RemoteHostLifecycle =>
  ({
    status: () => CONNECTED,
    connect: vi.fn(async () => CONNECTED),
    reconnect: vi.fn(async () => CONNECTED),
    disconnect: vi.fn(async () => DISCONNECTED),
    ...over,
  }) as unknown as RemoteHostLifecycle;

const mountApp = (over: Partial<RemoteHostRouteDeps> = {}): Express => {
  const app = express();
  app.use(express.json());
  const deps: RemoteHostRouteDeps = {
    isAllowedOrigin: () => true,
    getLifecycle: () => fakeLifecycle(),
    exportSession: () => SESSION_BLOB,
    reconnectErrorStatus: (err) => (err instanceof ExpiredError ? 401 : 500),
    currentHealth: () => ONLINE,
    ...over,
  };
  mountRemoteHostRoutes(app, deps);
  return app;
};

describe("remote-host routes", () => {
  it("GET /status returns { status, session, health }", async () => {
    const res = await request(mountApp()).get("/api/remote-host/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: CONNECTED, session: SESSION_BLOB, health: ONLINE });
  });

  it("POST /connect signs in and returns { status, session, health }", async () => {
    const connect = vi.fn(async () => CONNECTED);
    const res = await request(mountApp({ getLifecycle: () => fakeLifecycle({ connect }) }))
      .post("/api/remote-host/connect")
      .send({ idToken: "tok" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: CONNECTED, session: SESSION_BLOB, health: ONLINE });
    expect(connect).toHaveBeenCalledWith("tok");
  });

  it("POST /connect without idToken is 400", async () => {
    const res = await request(mountApp()).post("/api/remote-host/connect").send({});
    expect(res.status).toBe(400);
  });

  it("POST /reconnect restores a parked blob and returns { status, session, health } (case 1)", async () => {
    const reconnect = vi.fn(async () => CONNECTED);
    const res = await request(mountApp({ getLifecycle: () => fakeLifecycle({ reconnect }) }))
      .post("/api/remote-host/reconnect")
      .send({ session: "parked-blob" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: CONNECTED, session: SESSION_BLOB, health: ONLINE });
    expect(reconnect).toHaveBeenCalledWith("parked-blob");
  });

  it("POST /reconnect maps an expired/invalid blob to 401 (case 2)", async () => {
    const reconnect = vi.fn(async () => {
      throw new ExpiredError("gone");
    });
    const res = await request(mountApp({ getLifecycle: () => fakeLifecycle({ reconnect }) }))
      .post("/api/remote-host/reconnect")
      .send({ session: "stale" });
    expect(res.status).toBe(401);
  });

  it("POST /reconnect keeps transient failures at 5xx (case 3)", async () => {
    const reconnect = vi.fn(async () => {
      throw new Error("firestore unavailable");
    });
    const res = await request(mountApp({ getLifecycle: () => fakeLifecycle({ reconnect }) }))
      .post("/api/remote-host/reconnect")
      .send({ session: "good-blob" });
    expect(res.status).toBe(500);
  });

  it("POST /reconnect without a session is 400", async () => {
    const res = await request(mountApp()).post("/api/remote-host/reconnect").send({});
    expect(res.status).toBe(400);
  });

  it("POST /disconnect stops and returns { status, session, health }", async () => {
    const res = await request(mountApp()).post("/api/remote-host/disconnect");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: DISCONNECTED, session: SESSION_BLOB, health: OFFLINE });
  });

  it("rejects a forbidden origin with 403 before touching the lifecycle", async () => {
    const getLifecycle = vi.fn(() => fakeLifecycle());
    const res = await request(mountApp({ isAllowedOrigin: () => false, getLifecycle }))
      .post("/api/remote-host/connect")
      .send({ idToken: "tok" });
    expect(res.status).toBe(403);
    expect(getLifecycle).not.toHaveBeenCalled();
  });

  // #1094. A browser sends no Origin on a same-origin GET, so a /status judged by origin refused
  // every page served from a LAN address the operator had allowed — while every unguarded GET on
  // the server answered it. Nothing is protected by refusing: the response carries no CORS
  // headers, so a cross-site page cannot read it however the request is made.
  it("answers GET /status even when the origin predicate refuses everything", async () => {
    const res = await request(mountApp({ isAllowedOrigin: () => false })).get("/api/remote-host/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: CONNECTED, session: SESSION_BLOB, health: ONLINE });
  });

  it("returns 503 when the runner is not initialized", async () => {
    const res = await request(mountApp({ getLifecycle: () => null })).get("/api/remote-host/status");
    expect(res.status).toBe(503);
  });

  // The state the toolbar could not express before #823: still signed in, still connected
  // as far as the lifecycle knows, but the phone cannot reach us until the re-subscribe
  // lands — and the error that caused it travels with it.
  it("passes a reconnecting health through, error and all", async () => {
    const health: RunnerHealth = { state: "reconnecting", lastError: "listen: unavailable", changedAt: 7 };
    const res = await request(mountApp({ currentHealth: () => health })).get("/api/remote-host/status");
    expect(res.body.health).toEqual(health);
    expect(res.body.status.connected).toBe(true);
  });

  // An explicit disconnect leaves the last live reading behind; repeating it would show
  // "online" while nothing is subscribed at all.
  it("reports offline health whenever the lifecycle is not connected", async () => {
    const res = await request(mountApp({ getLifecycle: () => fakeLifecycle({ status: () => DISCONNECTED }) })).get("/api/remote-host/status");
    expect(res.body.health).toEqual(OFFLINE);
  });
});
