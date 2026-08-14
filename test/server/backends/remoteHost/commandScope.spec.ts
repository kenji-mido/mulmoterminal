// @vitest-environment node
//
// §3.4 is PREPARATION: no phone sends `project` yet, so the behaviour that matters most here is
// the one that must not change — every command still resolves the host's workspace. The rest pins
// the contract the phone will be held to when the picker lands, because the parts that are hard to
// change later are the ones written today.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";

import { scopeFromCommand } from "../../../../server/backends/remoteHost/commandScope.js";
import { initProjectRoots, projectId, resetProjectRootsForTesting } from "../../../../server/infra/project-root.js";

const WORKSPACE = "/srv/ws";
const PROJECT = "/srv/mag2";

beforeEach(() => {
  initProjectRoots({ workspace: WORKSPACE, knownProjects: () => [{ label: "mag2", path: PROJECT }] });
});

afterEach(() => {
  resetProjectRootsForTesting();
});

describe("scopeFromCommand", () => {
  it("resolves the host's workspace when a command names no project — today's every command", () => {
    expect(scopeFromCommand({})).toEqual({ workspaceRoot: WORKSPACE });
  });

  it("prefers the caller's injected root as the default, for the handlers built with one", () => {
    // listFeeds / listSkills / getFeed receive the root by injection rather than reading it
    // globally; the default must be THEIRS, or a factory pointed elsewhere silently drifts.
    expect(scopeFromCommand({}, "/srv/other")).toEqual({ workspaceRoot: "/srv/other" });
  });

  it("resolves a named project by its OPAQUE id", () => {
    expect(scopeFromCommand({ project: projectId(PROJECT) })).toEqual({ workspaceRoot: PROJECT });
  });

  // The phone is a genuinely remote client: a path in a command would publish the user's home
  // directory over the wire, and accepting one would make every handler an arbitrary-directory
  // reader. Only an id the server can resolve against its own list is accepted.
  it("refuses a PATH, even a real one", () => {
    expect(() => scopeFromCommand({ project: PROJECT })).toThrow(/unknown project/);
    expect(() => scopeFromCommand({ project: WORKSPACE })).toThrow(/unknown project/);
    expect(() => scopeFromCommand({ project: path.join(PROJECT, "..") })).toThrow(/unknown project/);
  });

  // The divergence from core's `readCommandScope` wording, asserted so it is a decision rather
  // than a drift: falling back would serve the workspace's records to a phone that asked for a
  // project's, which is the silent wrong-root answer this feature exists to remove.
  it("THROWS for a project it cannot resolve, rather than serving the workspace", () => {
    expect(() => scopeFromCommand({ project: "deadbeefdeadbeef" })).toThrow(/unknown project/);
  });

  it("does not echo the requested id back in the error", () => {
    expect(() => scopeFromCommand({ project: "s3cret-looking-id" })).toThrow(/^(?!.*s3cret).*$/);
  });

  // A non-string is "absent", not an error: core's own reader normalises it that way, and a
  // command with a malformed scope must land on the default rather than on a guess.
  it("treats a non-string or empty scope as absent", () => {
    expect(scopeFromCommand({ project: "" })).toEqual({ workspaceRoot: WORKSPACE });
    expect(scopeFromCommand({ project: 7 })).toEqual({ workspaceRoot: WORKSPACE });
    expect(scopeFromCommand({ project: null })).toEqual({ workspaceRoot: WORKSPACE });
    expect(scopeFromCommand({ project: ["a", "b"] })).toEqual({ workspaceRoot: WORKSPACE });
  });

  it("resolves the workspace by id too, so a phone may name it explicitly", () => {
    expect(scopeFromCommand({ project: projectId(WORKSPACE) })).toEqual({ workspaceRoot: WORKSPACE });
  });
});
