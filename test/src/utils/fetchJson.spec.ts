import { describe, it, expect, vi, afterEach } from "vitest";

import { DEFAULT_REQUEST_TIMEOUT_MS } from "../../../src/utils/fetchWithTimeout";
import { fetchJson, errorMessage } from "../../../src/utils/fetchJson";
import { isRecord } from "../../../common/isRecord";
import { jsonBody } from "../../../src/jsonBody";

// These cases are about transport and status handling, not about reading a shape, so the reader
// passes the body through untouched.
const readAny = (raw: unknown): unknown => raw;

// Callers branch on `status`: the collection UI treats 404 as "not found" and anything else
// as "skip". A transport failure reports 0 — there was no response to have a status — and
// conflating the two would make an offline browser look like a missing collection.
afterEach(() => vi.unstubAllGlobals());

describe("fetchJson", () => {
  it("returns what the reader made of the body, not the body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ a: 1, extra: "dropped" }) }));
    const readA = (raw: unknown): { a: number } => ({ a: isRecord(raw) && typeof raw.a === "number" ? raw.a : 0 });
    expect(await fetchJson("/api/x", readA)).toEqual({ ok: true, data: { a: 1 } });
  });

  // The reader is required precisely so this cannot be skipped: a body that does not match gets
  // the reader's answer rather than being handed on under the caller's type name.
  it("hands the reader a body that does not match, and returns what it decided", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => "not an object" }));
    const readA = (raw: unknown): { a: number } => ({ a: isRecord(raw) && typeof raw.a === "number" ? raw.a : 0 });
    expect(await fetchJson("/api/x", readA)).toEqual({ ok: true, data: { a: 0 } });
  });

  // A stub with no `json` at all — and the shape every /api route sends on failure.
  it("reports the HTTP status when the failure carries no body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await fetchJson("/api/x", readAny)).toEqual({ ok: false, error: "HTTP 404", status: 404 });
  });

  // #913: the server says WHY. Reporting only the status turned a fixable setting into an
  // unexplained "HTTP 400" — the sister app (MulmoClaude) has always read this body.
  it("surfaces the server's own reason from the error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "declare googleCalendar first" }) }));
    expect(await fetchJson("/api/x", readAny)).toEqual({ ok: false, error: "declare googleCalendar first", status: 400 });
  });

  it.each([
    [
      "a body that is not JSON (a proxy's HTML page)",
      502,
      async () => {
        throw new SyntaxError("Unexpected token <");
      },
    ],
    ["an empty body", 500, async () => null],
    ["a JSON body with no error field", 500, async () => ({ message: "nope" })],
    ["a JSON body whose error is not a string", 500, async () => ({ error: 42 })],
    ["a JSON body whose error is empty", 500, async () => ({ error: "" })],
  ])("falls back to HTTP <status> for %s", async (_case, status, json) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, json }));
    expect(await fetchJson("/api/x", readAny)).toEqual({ ok: false, error: `HTTP ${status}`, status });
  });

  // Callers branch on `status`, not on the message: the collection UI reads 404 as "not found".
  // Reading the body must not disturb that.
  it("keeps the status intact while reading the body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "no such collection" }) }));
    expect(await fetchJson("/api/x", readAny)).toMatchObject({ status: 404 });
  });

  // The distinction the callers depend on.
  it("reports status 0 when the request never reached a server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch")));
    expect(await fetchJson("/api/x", readAny)).toEqual({ ok: false, error: "Failed to fetch", status: 0 });
  });

  it("survives a rejection that is not an Error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("boom"));
    expect(await fetchJson("/api/x", readAny)).toEqual({ ok: false, error: "boom", status: 0 });
  });

  // A 200 whose body is not JSON must not be reported as success with garbage data.
  it("fails with status 0 when the body will not parse", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      }),
    );
    const result = await fetchJson("/api/x", readAny);
    expect(result).toMatchObject({ ok: false, status: 0 });
  });

  it("passes the request options through, plus the deadline every call now carries", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init) seen.push(init);
      return { ok: true, json: async () => ({}) };
    });
    await fetchJson("/api/x", readAny, { method: "POST" });
    expect(seen[0]?.method).toBe("POST");
    // #1393: this helper bounds every request it makes, so a signal is always along for the ride.
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  // The point of routing through fetchWithTimeout: a caller of this helper does not have to ask.
  it("gives up rather than waiting forever on a server that never answers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const pending = fetchJson("/api/x", readAny);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    const result = await pending;
    expect(result.ok).toBe(false);
    vi.useRealTimers();
  });
});

describe("errorMessage", () => {
  it("returns the server's error string when there is one", () => {
    expect(errorMessage({ error: "preset collections can't be deleted" }, 403)).toBe("preset collections can't be deleted");
  });

  it.each([
    ["error is not a string", { error: 42 }, 500],
    ["there is no error field", { message: "nope" }, 404],
    ["the body did not parse", null, 400],
    ["the body is a bare string", "just a string", 502],
    ["the body is a number", 123, 418],
    ["the body is an array", ["nope"], 500],
  ])("falls back to HTTP <status> when %s", (_case, body, status) => {
    expect(errorMessage(body, status)).toBe(`HTTP ${status}`);
  });
});

// jsonBody absorbs a parse failure into {}, which is right for a caller that only reads fields —
// and a trap for one that records having succeeded. These pin the callers that must not.
describe("a body that cannot be read stays on the failure path", () => {
  it("jsonBody answers {} for a truncated body rather than throwing", async () => {
    const res = { json: async () => JSON.parse("{oops") } as unknown as Response;
    await expect(jsonBody(res)).resolves.toEqual({});
  });

  it("jsonBody answers {} for a JSON body that is not an object", async () => {
    const res = { json: async () => [1, 2, 3] } as unknown as Response;
    await expect(jsonBody(res)).resolves.toEqual({});
  });
});
