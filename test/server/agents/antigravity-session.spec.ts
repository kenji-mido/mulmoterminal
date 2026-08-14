// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  antigravityConversationExists,
  listAntigravityConversationIds,
  snapshotAntigravitySessions,
  pickFreshAntigravitySession,
  watchForAntigravitySession,
} from "../../../server/agents/antigravity-session.js";

describe("antigravity-session", () => {
  const tmpDir = path.join(os.tmpdir(), `ag-session-test-${Date.now()}`);
  const brainDir = path.join(tmpDir, "brain");

  beforeEach(() => {
    fs.mkdirSync(brainDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists valid UUID directories in brain root", () => {
    const uuid1 = "a4dbbf1e-9cba-4879-a84a-d397b47e4f47";
    const uuid2 = "5fd4f183-39d4-4842-8e03-114e966e7fa5";
    fs.mkdirSync(path.join(brainDir, uuid1));
    fs.mkdirSync(path.join(brainDir, uuid2));
    fs.mkdirSync(path.join(brainDir, "not-a-uuid"));

    const sessions = listAntigravityConversationIds(brainDir);
    expect(sessions).toContain(uuid1);
    expect(sessions).toContain(uuid2);
    expect(sessions).not.toContain("not-a-uuid");
  });

  it("identifies fresh sessions created after snapshot", () => {
    const uuid1 = "a4dbbf1e-9cba-4879-a84a-d397b47e4f47";
    fs.mkdirSync(path.join(brainDir, uuid1));
    const before = snapshotAntigravitySessions(brainDir);

    const uuid2 = "5fd4f183-39d4-4842-8e03-114e966e7fa5";
    fs.mkdirSync(path.join(brainDir, uuid2));

    expect(pickFreshAntigravitySession(brainDir, before)).toBe(uuid2);
  });

  it("watches and discovers a newly created session ID", async () => {
    const before = snapshotAntigravitySessions(brainDir);
    const uuid = "c4f15571-6d41-4d32-9149-72b353fc3d7c";

    setTimeout(() => {
      fs.mkdirSync(path.join(brainDir, uuid));
    }, 50);

    expect(await watchForAntigravitySession(brainDir, before, { pollMs: 20, maxWaitMs: 1000 })).toBe(uuid);
  });

  // Two watchers awaiting the same poll interval both saw a lone conversation unclaimed when the
  // claim waited for the caller's `.then` (#1533) — so the watcher claims at the moment it selects.
  it("claims the conversation it selects, synchronously with the selection", async () => {
    const before = snapshotAntigravitySessions(brainDir);
    const uuid = "d5e26682-7e52-4e43-a25a-83c464fd4e88";
    fs.mkdirSync(path.join(brainDir, uuid));
    const claimed = new Set<string>();
    expect(await watchForAntigravitySession(brainDir, before, { pollMs: 20, maxWaitMs: 1000, claimed })).toBe(uuid);
    expect(claimed.has(uuid)).toBe(true);
  });

  // The cold-resume guard. Without it every requested key is handed to `agy --conversation`,
  // and agy answers a conversation it cannot find by silently starting a fresh one under the
  // old session's id.
  describe("antigravityConversationExists", () => {
    const uuid = "a4dbbf1e-9cba-4879-a84a-d397b47e4f47";

    it("is true for a conversation directory that is there", () => {
      fs.mkdirSync(path.join(brainDir, uuid));
      expect(antigravityConversationExists(brainDir, uuid)).toBe(true);
    });

    it("is false for a key that never named a conversation", () => {
      expect(antigravityConversationExists(brainDir, uuid)).toBe(false);
    });

    // The key reaches this straight from a URL query, so a traversal must not become a probe
    // of the filesystem outside the brain root.
    it("is false for anything that is not a uuid", () => {
      expect(antigravityConversationExists(brainDir, "../../etc")).toBe(false);
      expect(antigravityConversationExists(brainDir, "")).toBe(false);
    });
  });
});
