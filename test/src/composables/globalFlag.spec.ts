import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGlobalFlag } from "../../../src/composables/globalFlag";

// The one piece of this that is easy to get backwards: a MISSING key is not uniformly false.
// `issueWorkComments` and friends stay off unless the config says `true`, while `prWorkdirFooter`
// and `appendSystemPrompt` are on unless it says `false` — mirroring their server sanitizers. Get
// it wrong and the checkbox disagrees with what the server actually does, which nothing else here
// would notice: the value round-trips, the POST succeeds, and only the behaviour differs.

let posts: Record<string, unknown>[] = [];

beforeEach(() => {
  posts = [];
  globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    const body: Record<string, unknown> = init?.body ? JSON.parse(init.body) : {};
    posts.push(body);
    return { ok: true, json: async () => body };
  }) as unknown as typeof fetch;
});

describe("createGlobalFlag — opt-in (default off)", () => {
  it("is on only for the boolean true", () => {
    const flag = createGlobalFlag("issueWorkComments", false);
    expect(flag.state.value).toBe(false);
    flag.set(true);
    expect(flag.state.value).toBe(true);
    // Everything that is not `true` reads as off, including a config written before the key existed
    // and a hand-edit that quoted it.
    for (const value of [undefined, null, "true", 1, {}]) {
      flag.set(value);
      expect(flag.state.value).toBe(false);
    }
  });
});

describe("createGlobalFlag — opt-out (default on)", () => {
  it("is off only for the boolean false", () => {
    const flag = createGlobalFlag("prWorkdirFooter", true);
    expect(flag.state.value).toBe(true);
    flag.set(false);
    expect(flag.state.value).toBe(false);
    // The key being ABSENT is the case every config file written before the feature has, and it
    // must leave the feature on.
    for (const value of [undefined, null, "false", 0, {}]) {
      flag.set(value);
      expect(flag.state.value).toBe(true);
    }
  });
});

describe("createGlobalFlag saving", () => {
  it("posts its own field and adopts the server's echo", async () => {
    const flag = createGlobalFlag("decisionDigest", false);
    expect(await flag.save(true)).toBe(true);
    expect(posts).toEqual([{ decisionDigest: true }]);
    expect(flag.state.value).toBe(true);
  });

  // The echo is what lands, not what was sent: a server that refused the value must not leave the
  // control showing the user's click as though it had taken.
  it("takes the echoed value rather than the requested one", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ decisionDigest: false }) })) as unknown as typeof fetch;
    const flag = createGlobalFlag("decisionDigest", false);
    await flag.save(true);
    expect(flag.state.value).toBe(false);
  });

  it("leaves the value alone when the save fails", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    const flag = createGlobalFlag("prWorkdirFooter", true);
    expect(await flag.save(false)).toBe(false);
    expect(flag.state.value).toBe(true);
  });

  // The imperative reader the terminal-side callers use, kept in step with the rendered one.
  it("reads the same value through the getter", () => {
    const flag = createGlobalFlag("copyOnSelect", false);
    flag.set(true);
    expect(flag.read()).toBe(true);
    expect(flag.read()).toBe(flag.state.value);
  });
});
