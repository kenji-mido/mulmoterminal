import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { encodeGrokCwd, grokSessionDir, grokConversationExists, grokConversationExistsInAnyCwd } from "../../../server/agents/grok-session.js";

const ID = "019fcf22-289b-7773-b19c-462d5c08d061";
const roots: string[] = [];
const tempRoot = (): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "grok-sessions-"));
  roots.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// These three cases were read off a REAL grok 0.2.118 session rather than assumed, because the
// whole resume path rests on the encoding and getting it wrong fails silently: the directory is
// simply not found, the resume is declined, and the user gets a fresh conversation under an id that
// already had one.
describe("encodeGrokCwd", () => {
  it("escapes the separators", () => {
    expect(encodeGrokCwd("/Users/satoshi/mulmoclaude")).toBe("%2FUsers%2Fsatoshi%2Fmulmoclaude");
  });

  it("escapes a space, and leaves a hyphen alone", () => {
    expect(encodeGrokCwd("/home/u/grok enc-test")).toBe("%2Fhome%2Fu%2Fgrok%20enc-test");
  });

  it("writes non-ASCII as upper-case percent-encoded UTF-8", () => {
    expect(encodeGrokCwd("/home/u/日本語-dir")).toBe("%2Fhome%2Fu%2F%E6%97%A5%E6%9C%AC%E8%AA%9E-dir");
  });
});

describe("grokConversationExists", () => {
  const cwd = "/Users/satoshi/project";

  it("finds a conversation directory grok created for this cwd", () => {
    const root = tempRoot();
    mkdirSync(grokSessionDir(root, cwd, ID), { recursive: true });
    expect(grokConversationExists(root, cwd, ID)).toBe(true);
  });

  // The partition is the point: the same id under a DIFFERENT directory is a different
  // conversation, and resuming across the two would answer with someone else's history.
  it("does not find it under another cwd", () => {
    const root = tempRoot();
    mkdirSync(grokSessionDir(root, cwd, ID), { recursive: true });
    expect(grokConversationExists(root, "/Users/satoshi/other", ID)).toBe(false);
  });

  it("is false for an id grok never minted, and for a missing root", () => {
    const root = tempRoot();
    expect(grokConversationExists(root, cwd, ID)).toBe(false);
    expect(grokConversationExists(path.join(root, "nope"), cwd, ID)).toBe(false);
  });

  // A MulmoTerminal key that is not a UUID must never reach `grok --resume`, where it would be an
  // argument we did not validate.
  it("refuses a non-UUID key", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, encodeGrokCwd(cwd), "not-a-uuid"), { recursive: true });
    expect(grokConversationExists(root, cwd, "not-a-uuid")).toBe(false);
  });
});

// The survivor-identity guard's probe (#1537): after a restart the request's cwd is often the
// defaulted workspace, so asking under it would miss the conversation that is right there.
describe("grokConversationExistsInAnyCwd", () => {
  const cwd = "/Users/satoshi/project";

  it("finds the conversation whichever cwd partition holds it", () => {
    const root = tempRoot();
    mkdirSync(grokSessionDir(root, cwd, ID), { recursive: true });
    expect(grokConversationExistsInAnyCwd(root, ID)).toBe(true);
  });

  it("is false for an id grok never minted, for a missing root, and for a non-UUID key", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, encodeGrokCwd(cwd)), { recursive: true });
    expect(grokConversationExistsInAnyCwd(root, ID)).toBe(false);
    expect(grokConversationExistsInAnyCwd(path.join(root, "nope"), ID)).toBe(false);
    expect(grokConversationExistsInAnyCwd(root, "not-a-uuid")).toBe(false);
  });
});
