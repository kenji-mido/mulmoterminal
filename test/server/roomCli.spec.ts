// @vitest-environment node
// The CLI's argument parsing, on its own — because the argument being parsed is a MESSAGE somebody
// is posting, and a parser that treats every `--token` as a flag silently eats part of it
// (Codex review on #1456). `bin/*.js` is plain JS with no other coverage, so this is where it gets
// pinned.
import { describe, it, expect, vi, afterEach } from "vitest";

const { positionalForTest, flagForTest, portForTest, runRoom } = await import("../../bin/room.js");

describe("room CLI arguments", () => {
  it("keeps the whole message, including words that look like flags", () => {
    const args = ["post", "standup", "use", "--force", "carefully"];
    expect(positionalForTest(args)).toEqual(["post", "standup", "use", "--force", "carefully"]);
  });

  it("still consumes the flags it does know, and their values", () => {
    const args = ["post", "standup", "hello", "--port", "34599", "--from", "ci"];
    expect(positionalForTest(args)).toEqual(["post", "standup", "hello"]);
    expect(flagForTest(args, "--from")).toBe("ci");
  });

  // A message that really does begin with a known flag still has to be postable.
  it("stops parsing flags at `--`", () => {
    expect(positionalForTest(["post", "standup", "--", "--port", "is", "the", "topic"])).toEqual(["post", "standup", "--port", "is", "the", "topic"]);
  });

  it("does not treat an unknown flag as taking a value", () => {
    expect(positionalForTest(["post", "r", "--wat", "keep-me"])).toEqual(["post", "r", "--wat", "keep-me"]);
  });

  // `--` has to mean the same thing to EVERY reader. It kept the message text intact while
  // `--from` and `--port` were still picked up from inside it, so a message that discussed a flag
  // silently changed who the post came from (Codex review on #1456).
  it("keeps a flag after `--` out of the flag readers, not just out of the text", () => {
    const args = ["post", "standup", "--", "ask", "about", "--from", "ci"];
    expect(positionalForTest(args)).toEqual(["post", "standup", "ask", "about", "--from", "ci"]);
    expect(flagForTest(args, "--from")).toBeUndefined();
  });

  it("keeps a port after `--` from redirecting the request", () => {
    expect(portForTest(["post", "r", "--", "try", "--port", "9999"])).not.toBe(9999);
    expect(portForTest(["post", "r", "--port", "34599", "hello"])).toBe(34599);
  });
});

// What the parser decides is only half of it — CodeRabbit asked for the REQUEST. This asserts the
// URL and the JSON body the CLI actually sends, which is what a user is affected by (#1456).
describe("room post — what is actually sent", () => {
  const sent: { url: string; body: unknown }[] = [];
  const stubFetch = () => {
    globalThis.fetch = vi.fn(async (url: string, init?: { body?: string }) => {
      sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;
  };
  afterEach(() => {
    sent.length = 0;
    vi.restoreAllMocks();
  });

  it("posts the message and the flags the user meant", async () => {
    stubFetch();
    await runRoom(["post", "standup", "hello", "there", "--from", "ci", "--port", "34599"]);
    expect(sent[0]?.url).toBe("http://localhost:34599/api/rooms/standup");
    expect(sent[0]?.body).toEqual({ from: "ci", text: "hello there" });
  });

  // The whole point of `--`: everything after it is the message, and nothing after it may change
  // who the post is from or where it goes.
  it("keeps flags after `--` inside the message, not in the request", async () => {
    stubFetch();
    await runRoom(["post", "standup", "--from", "ci", "--", "should", "we", "use", "--port", "9999"]);
    expect(sent[0]?.url).toBe("http://localhost:34567/api/rooms/standup"); // not 9999
    expect(sent[0]?.body).toEqual({ from: "ci", text: "should we use --port 9999" });
  });
});
