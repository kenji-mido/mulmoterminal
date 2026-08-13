import { describe, it, expect } from "vitest";

import { canAddLauncher, canAddMcpServer, canAddRepo } from "../../../src/components/settingsValidators";

describe("canAddRepo", () => {
  it("accepts owner/repo", () => {
    expect(canAddRepo("receptron/mulmoterminal", [])).toBe(true);
    expect(canAddRepo("a_c-d/e.f_g-h", [])).toBe(true);
  });

  // The field now takes what the config can store, which is the same rule (#981): an entry may
  // name its host for a repository that is not on GitHub. Before this the form rejected exactly
  // what the file accepted.
  it("accepts a host-qualified entry, including a nested GitLab group", () => {
    expect(canAddRepo("gitlab.com/group/project", [])).toBe(true);
    expect(canAddRepo("gitlab.com/group/sub/project", [])).toBe(true);
  });

  // A DOT in the first segment is what marks a host, so `a.b/c` reads as host `a.b` with one
  // segment after it — not a repository anywhere. It could never have been a GitHub repo either:
  // owner and organisation names may hold only alphanumerics and hyphens.
  it.each([["a.b_c-d/e.f_g-h"], ["owner/repo/extra"], ["owner//repo"]])("rejects the ambiguous %s", (entry) => {
    expect(canAddRepo(entry, [])).toBe(false);
  });

  it("trims before validating", () => {
    expect(canAddRepo("  owner/repo  ", [])).toBe(true);
  });

  // A malformed value silently breaks the cross-repo PR fetch, so the button must stay disabled.
  it.each([["norepo"], ["owner/"], ["/repo"], ["owner/repo/extra"], ["owner repo"], ["owner/re po"], [""]])("rejects the malformed %j", (repo) => {
    expect(canAddRepo(repo, [])).toBe(false);
  });

  it("rejects a duplicate", () => {
    expect(canAddRepo("a/b", ["a/b"])).toBe(false);
    // …after trimming, so a padded duplicate is still caught.
    expect(canAddRepo("  a/b ", ["a/b"])).toBe(false);
  });
});

describe("canAddLauncher", () => {
  it("needs both a label and a command", () => {
    expect(canAddLauncher("Shell", "$SHELL", [])).toBe(true);
    expect(canAddLauncher("", "$SHELL", [])).toBe(false);
    expect(canAddLauncher("Shell", "", [])).toBe(false);
    expect(canAddLauncher("   ", "   ", [])).toBe(false);
  });

  it("rejects a duplicate label", () => {
    expect(canAddLauncher("Shell", "zsh", [{ label: "Shell" }])).toBe(false);
  });
});

describe("canAddMcpServer", () => {
  it("accepts a safe id and an http(s) url", () => {
    expect(canAddMcpServer("my-server", "https://example.com/mcp", [])).toBe(true);
    expect(canAddMcpServer("srv_1", "http://localhost:3000", [])).toBe(true);
  });

  // The id becomes the mcp__<id> tool prefix — a bad one breaks the tool namespace.
  it.each([["has space"], ["has/slash"], ["dot.name"], [""], ["has:colon"]])("rejects the unsafe id %j", (id) => {
    expect(canAddMcpServer(id, "https://example.com", [])).toBe(false);
  });

  // A non-http url breaks the MCP connection.
  it.each([["f" + "tp://host"], ["example.com"], ["w" + "s://host"], ["https://"], ["https:// space"], [""]])("rejects the non-http url %j", (url) => {
    expect(canAddMcpServer("srv", url, [])).toBe(false);
  });

  it("rejects a duplicate id", () => {
    expect(canAddMcpServer("srv", "https://a.com", [{ id: "srv" }])).toBe(false);
  });
});
