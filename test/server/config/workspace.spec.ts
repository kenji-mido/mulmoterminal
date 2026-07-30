import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTempDirAsync } from "../../support/tempDir.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { workspaceRequest, existingWorkspace, existingWorkspaceFromQuery } from "../../../server/config/workspace.js";
import { CLAUDE_CWD } from "../../../server/config/env.js";
import { cwdProblemMessage } from "../../../server/infra/spawn-cwd.js";

// workspaceRequest guards what becomes a PTY's cwd, so every rejection matters: anything it lets
// through unchecked is a path the client chose. It also decides what a rejection MEANS — #1151:
// a directory that was named and cannot be used is not the same request as one that named none,
// and answering both with the default workspace is how a terminal opened somewhere else in
// silence.
describe("workspaceRequest", () => {
  let dir = "";
  let file = "";

  beforeAll(async () => {
    dir = await makeTempDirAsync("mt-ws-");
    file = path.join(dir, "a-file");
    await fs.writeFile(file, "");
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("accepts an absolute path to an existing directory", () => {
    expect(workspaceRequest(dir)).toEqual({ kind: "resolved", cwd: dir });
  });

  // No directory was asked for, so the default IS the answer — the case the fallback was right
  // for, and the only one that keeps it. An empty param is how a browser spells the same thing.
  it("answers the default workspace when no directory is named", () => {
    expect(workspaceRequest(undefined)).toEqual({ kind: "default", cwd: CLAUDE_CWD });
    expect(workspaceRequest(null)).toEqual({ kind: "default", cwd: CLAUDE_CWD });
    expect(workspaceRequest("")).toEqual({ kind: "default", cwd: CLAUDE_CWD });
  });

  it("refuses a relative path, however real it is, and says it is not absolute", () => {
    for (const relative of ["server", "./server", "../mulmoterminal"]) {
      const request = workspaceRequest(relative);
      expect(request.kind).toBe("unusable");
      expect(request).toMatchObject({ requested: relative, malformed: true });
      if (request.kind === "unusable") expect(request.problem).toContain("is not an absolute path");
    }
  });

  // The #1146 shape: the path was real when it was recorded and is not any more. The wording is
  // SpawnCwdError's own (#1078), so the reason reads the same whether the directory is refused
  // here or by the spawn itself.
  it("refuses a path that does not exist, in the words a refused spawn uses", () => {
    const gone = path.join(dir, "no-such-dir");
    const request = workspaceRequest(gone);
    expect(request).toMatchObject({ kind: "unusable", requested: gone, malformed: false });
    if (request.kind === "unusable") expect(request.problem).toBe(cwdProblemMessage(gone, { kind: "missing" }));
  });

  it("refuses a file — a cwd has to be a directory", () => {
    const request = workspaceRequest(file);
    expect(request).toMatchObject({ kind: "unusable", malformed: false });
    if (request.kind === "unusable") expect(request.problem).toBe(cwdProblemMessage(file, { kind: "not-a-directory" }));
  });

  // Express hands over an array when a param repeats (?cwd=a&cwd=b). It was ASKED for, so it is
  // refused rather than quietly swapped for the default — but as a malformed request, not a
  // missing directory.
  it("refuses anything that is not a string, having been given one", () => {
    expect(workspaceRequest(["/tmp", "/etc"])).toMatchObject({ kind: "unusable", malformed: true });
    expect(workspaceRequest(42)).toMatchObject({ kind: "unusable", malformed: true });
  });
});

// The raw guard behind workspaceRequest, still used directly by the routes that answer their own
// "unknown directory" payload rather than a refusal (Codex, #952).
describe("existingWorkspace", () => {
  it("returns a real directory unchanged", () => {
    expect(existingWorkspace(process.cwd())).toBe(process.cwd());
  });

  it("returns null instead of a fallback for a path that isn't there", () => {
    expect(existingWorkspace("/definitely/not/a/directory/here")).toBeNull();
    expect(existingWorkspace("relative/path")).toBeNull();
    expect(existingWorkspace(null)).toBeNull();
  });

  it("returns null for a file, which is not a workspace", () => {
    expect(existingWorkspace(new URL(import.meta.url).pathname)).toBeNull();
  });

  it("reads the query param the same way, rejecting a non-string", () => {
    expect(existingWorkspaceFromQuery(process.cwd())).toBe(process.cwd());
    expect(existingWorkspaceFromQuery(["/tmp"])).toBeNull();
    expect(existingWorkspaceFromQuery(undefined)).toBeNull();
  });
});

// #1002. These guards let `/a/b/` through — it is absolute and it stats as a directory — and the
// value they return is the identity the directory is known by from then on: the PTY's cwd, the cwd
// echoed back to the cell, the key its dir-config subscription uses, and the recorded preset.
// Returned verbatim, one directory had two names, and a `.mulmoterminal.json` change announced on
// the canonical one never reached a cell launched from the other.
describe("canonical spelling of the accepted directory", () => {
  let dir = "";

  beforeAll(async () => {
    dir = await makeTempDirAsync("mt-ws-canon-");
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("drops a trailing separator — the shape tab-completion leaves behind", () => {
    expect(existingWorkspace(dir + path.sep)).toBe(dir);
    expect(existingWorkspaceFromQuery(dir + path.sep)).toBe(dir);
    expect(workspaceRequest(dir + path.sep)).toEqual({ kind: "resolved", cwd: dir });
  });

  it("collapses . and .. inside an absolute path", () => {
    expect(workspaceRequest(path.join(dir, "sub", ".."))).toEqual({ kind: "resolved", cwd: dir });
    expect(workspaceRequest(path.join(dir, "."))).toEqual({ kind: "resolved", cwd: dir });
  });

  it("leaves an already-canonical path untouched", () => {
    expect(workspaceRequest(dir)).toEqual({ kind: "resolved", cwd: dir });
  });

  // The guard order matters: canonicalizing BEFORE the isAbsolute check would splice a relative
  // string onto the server's own cwd and hand back a directory the client never asked for.
  it("still refuses a relative path rather than resolving it against the server's cwd", () => {
    expect(existingWorkspace("server")).toBeNull();
    expect(existingWorkspace("./server")).toBeNull();
  });

  // Codex review of #1016. Canonicalizing AFTER the stat returns a path nothing checked: `stat`
  // resolves symlinks in the kernel, `path.resolve` is purely lexical, and the two part ways as
  // soon as a `..` follows a symlink into a DIFFERENT parent.
  //
  //   <dir>/link -> <dir>/sub/target
  //   <dir>/link/../sibling   kernel: link -> sub/target, .. -> sub  =>  <dir>/sub/sibling (exists)
  //                           lexical:                                   <dir>/sibling     (does not)
  //
  // Stat-then-resolve therefore accepts the input and hands back <dir>/sibling, which was never
  // validated and is not there. The invariant: whatever comes back was the thing that was checked.
  it.skipIf(process.platform === "win32")("never returns a directory it did not stat", async () => {
    const target = path.join(dir, "sub", "target");
    const sibling = path.join(dir, "sub", "sibling");
    await fs.mkdir(target, { recursive: true });
    await fs.mkdir(sibling, { recursive: true });
    const link = path.join(dir, "link");
    await fs.symlink(target, link);

    // Concatenated, NOT path.join: join collapses the `..` itself, so the string would never
    // reach the kernel with a symlink still in front of it and the fixture would test nothing.
    const viaLink = `${link}${path.sep}..${path.sep}sibling`;
    // Guard the fixture itself: the divergence has to be real, or the assertion below is vacuous.
    expect((await fs.stat(viaLink)).isDirectory()).toBe(true);
    expect(path.resolve(viaLink)).toBe(path.join(dir, "sibling"));

    const answer = existingWorkspace(viaLink);
    expect(answer).toBeNull();
  });

  it("keeps the filesystem root, whose separator is not trailing", () => {
    const root = path.parse(dir).root;
    expect(workspaceRequest(root)).toEqual({ kind: "resolved", cwd: root });
  });
});
