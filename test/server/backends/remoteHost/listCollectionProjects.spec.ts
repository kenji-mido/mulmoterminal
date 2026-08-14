// @vitest-environment node
//
// How the phone LEARNS which projects it may name. The handlers could already resolve a named one
// (commandScope.ts); without this they could resolve an id the phone had no way to obtain.
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { listCollectionProjects } from "../../../../server/backends/remoteHost/handlers/listCollectionProjects.js";
import { scopeFromCommand } from "../../../../server/backends/remoteHost/commandScope.js";
import { initProjectRoots, projectId, resetProjectRootsForTesting } from "../../../../server/infra/project-root.js";

const WORKSPACE = "/srv/ws";
const PROJECT = "/srv/mag2";

interface Listing {
  projects: { id: string; label: string; cwd?: unknown }[];
}

beforeEach(() => {
  initProjectRoots({ workspace: WORKSPACE, knownProjects: () => [{ label: "mag2", path: PROJECT }] });
});

afterEach(() => {
  resetProjectRootsForTesting();
});

describe("listCollectionProjects", () => {
  it("lists the workspace first, then the saved directories", async () => {
    const { projects } = (await listCollectionProjects({})) as unknown as Listing;
    expect(projects.map((project) => project.label)).toEqual(["ws", "mag2"]);
  });

  // The phone is a genuinely remote client: an absolute root in a command or an artifact
  // publishes the user's home directory over the wire. The browser's listing carries `cwd`
  // because it has to match a project to a cell it is already showing; the phone has no such
  // need, so the path stays on the host.
  it("carries NO path — only the opaque id and a label", async () => {
    const { projects } = (await listCollectionProjects({})) as unknown as Listing;
    for (const project of projects) {
      expect(Object.keys(project).sort()).toEqual(["id", "label"]);
    }
    expect(JSON.stringify(projects)).not.toContain("/srv");
  });

  // The listing is only useful if what it hands out is what the handlers accept — the two halves
  // are separately correct and together are the feature.
  it("hands out ids the command scope resolves", async () => {
    const { projects } = (await listCollectionProjects({})) as unknown as Listing;
    for (const project of projects) {
      expect(scopeFromCommand({ project: project.id })).toEqual({ workspaceRoot: project.label === "ws" ? WORKSPACE : PROJECT });
    }
    expect(projects.map((project) => project.id)).toEqual([projectId(WORKSPACE), projectId(PROJECT)]);
  });

  // `cwdPresets` dedupes by PATH and an auto-derived label is just the basename, so a repo and
  // its clone are both "mulmoclaude" — this is the author's own config. The browser tells them
  // apart by the `cwd` it also receives; the phone deliberately gets none, so two identical rows
  // would be a coin toss.
  describe("labels a person can tell apart", () => {
    const listing = async () => ((await listCollectionProjects({})) as unknown as Listing).projects;

    it("borrows the least it needs from the parent directories", async () => {
      initProjectRoots({
        workspace: "/Users/me/mulmoclaude",
        knownProjects: () => [{ label: "mulmoclaude", path: "/Users/me/git/ai/mulmoclaude" }],
      });
      expect((await listing()).map((project) => project.label)).toEqual(["me/mulmoclaude", "ai/mulmoclaude"]);
    });

    it("leaves a label that is already unique completely alone", async () => {
      initProjectRoots({ workspace: "/srv/ws", knownProjects: () => [{ label: "mag2", path: "/srv/mag2" }] });
      expect((await listing()).map((project) => project.label)).toEqual(["ws", "mag2"]);
    });

    it("still carries no absolute path, however deep it had to borrow", async () => {
      initProjectRoots({
        workspace: "/Users/me/a/b/c/dup",
        knownProjects: () => [{ label: "dup", path: "/Users/me/x/b/c/dup" }],
      });
      for (const project of await listing()) {
        expect(project.label.startsWith("/")).toBe(false);
        expect(project.label).not.toContain("/Users/me");
      }
    });

    // Saved labels are ARBITRARY STRINGS — hand-edited, written by an older version, or set to the
    // directory itself. One that IS a path is perfectly unique, so nothing else here would look
    // at it twice, and it would go out verbatim to a client the protocol promises never receives
    // one. The rule is this listing's to keep, not something to assume of the config.
    it("replaces a saved label that is itself a path", async () => {
      initProjectRoots({
        workspace: "/srv/ws",
        knownProjects: () => [
          { label: "/Users/alice/work/private", path: "/Users/alice/work/private" },
          { label: "~/secrets/vault", path: "/Users/alice/secrets/vault" },
          { label: "C:\\Users\\alice\\win", path: "/Users/alice/win" },
        ],
      });
      const labels = (await listing()).map((project) => project.label);
      expect(labels).toEqual(["ws", "private", "vault", "win"]);
    });

    it("keeps a hand-written label that is a NAME rather than a location", async () => {
      initProjectRoots({
        workspace: "/srv/ws",
        knownProjects: () => [{ label: "Client work (2026)", path: "/srv/clients" }],
      });
      expect((await listing()).map((project) => project.label)).toEqual(["ws", "Client work (2026)"]);
    });

    it("never lets a path through, whatever the config says", async () => {
      initProjectRoots({
        workspace: "/Users/alice/ws",
        knownProjects: () => [
          { label: "/Users/alice/a", path: "/Users/alice/a" },
          { label: "  ", path: "/Users/alice/b" },
        ],
      });
      for (const project of await listing()) {
        expect(project.label).not.toContain("/");
        expect(project.label).not.toContain("\\");
        expect(project.label.trim()).not.toBe("");
      }
    });

    // A project at a filesystem ROOT has no directory name to fall back to: `lastSegment("/")` is
    // `"/"` and a Windows drive root is `"C:"`. Both would walk past the check just made.
    it("does not fall back to a path for a project at the filesystem root", async () => {
      initProjectRoots({
        workspace: "/",
        knownProjects: () => [{ label: "C:\\", path: "C:\\" }],
      });
      const labels = (await listing()).map((project) => project.label);
      for (const label of labels) {
        expect(label).not.toContain("/");
        expect(label).not.toContain("\\");
        expect(label).not.toContain(":");
      }
      // Two nameless roots collide, and the normal disambiguation resolves them.
      expect(new Set(labels).size).toBe(2);
      // A root has NO segments to borrow, so the "distinguishing" tail was a blank string — the
      // second way a tail can fail, after being a location in its own right.
      for (const label of labels) expect(label.trim()).not.toBe("");
    });

    // A Windows path split on "/" alone is ONE segment, so the "tail" would be the whole absolute
    // path — the no-path guarantee off on Windows, with nothing in the code that states it
    // changing at all.
    it("never returns a Windows path as a label", async () => {
      initProjectRoots({
        workspace: "C:\\Users\\me\\dup",
        knownProjects: () => [{ label: "dup", path: "C:\\work\\dup" }],
      });
      const labels = (await listing()).map((project) => project.label);
      expect(new Set(labels).size).toBe(2);
      for (const label of labels) {
        expect(label).not.toContain("\\");
        expect(label).not.toContain("C:");
        expect(label).not.toContain("Users");
      }
    });

    // Two directories whose tails match all the way up: the id breaks the tie rather than the
    // listing walking to the home directory.
    it("falls back to an id fragment rather than sending the whole path", async () => {
      initProjectRoots({
        workspace: "/one/a/b/dup",
        knownProjects: () => [{ label: "dup", path: "/two/a/b/dup" }],
      });
      const labels = (await listing()).map((project) => project.label);
      expect(new Set(labels).size).toBe(2);
      for (const label of labels) expect(label.split("/").length).toBeLessThanOrEqual(3);
    });
  });

  // The handler being correct is half of it; the phone can only call a command the TABLE carries.
  // That registration is one line in a 20-entry object, which is exactly the kind of line a merge
  // drops without anything failing.
  it("is registered in the command table the runner serves", async () => {
    const { createRemoteHostHandlers } = await import("../../../../server/backends/remoteHost/handlers/index.js");
    const handlers = createRemoteHostHandlers({
      workspace: WORKSPACE,
      spawnChat: () => ({ chatId: "x" }),
      ingest: async () => ({ attachments: [], cleanup: async () => {} }) as never,
      listTerminalSessions: async () => ({}) as never,
      captureTerminalScreen: async () => ({}) as never,
      writeToSession: () => false,
    } as never);
    expect(typeof handlers.listCollectionProjects).toBe("function");
    const answered = (await handlers.listCollectionProjects({})) as unknown as Listing;
    expect(answered.projects.map((project) => project.label)).toEqual(["ws", "mag2"]);
  });

  it("is just the workspace when nothing else is saved", async () => {
    initProjectRoots({ workspace: WORKSPACE });
    const { projects } = (await listCollectionProjects({})) as unknown as Listing;
    expect(projects).toEqual([{ id: projectId(WORKSPACE), label: "ws" }]);
  });
});
