// @vitest-environment node
// `.mulmoterminal.local.json` — this checkout's own overrides on top of the shared file (#1430).
//
// The case it exists for: several clones of one repository, identical as projects, differing only
// in the colour that tells them apart in the grid. Before this the shared part was copied once per
// clone, so fixing it in one left the others behind.
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir.js";
import { loadDirConfig, dirConfigDetail, dirConfigWriteTarget, DIR_CONFIG_FILE, DIR_LOCAL_CONFIG_FILE } from "../../../server/config/dir-config";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function project(shared: unknown, local?: unknown): string {
  const dir = makeTempDir("mt-localcfg-");
  dirs.push(dir);
  const write = (name: string, body: unknown) => writeFileSync(path.join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  if (shared !== undefined) write(DIR_CONFIG_FILE, shared);
  if (local !== undefined) write(DIR_LOCAL_CONFIG_FILE, local);
  return dir;
}

describe("the local file layers over the shared one", () => {
  it("keeps shared keys and takes the local ones", () => {
    const dir = project({ name: "acme", theme: "nord", badgeColor: "#112233", orderPriority: 10 }, { badgeColor: "#445566", orderPriority: 11 });
    const config = loadDirConfig(dir);
    expect(config.name).toBe("acme"); // shared: the project is the same project in every clone
    expect(config.theme).toBe("nord");
    expect(config.badgeColor).toBe("#445566"); // local: what makes THIS clone recognisable
    expect(config.orderPriority).toBe(11);
  });

  it("works with only a local file — a clone may carry nothing shared", () => {
    expect(loadDirConfig(project(undefined, { name: "just-local", badgeColor: "#010203" })).name).toBe("just-local");
  });

  it("changes nothing for a directory that has only the shared file", () => {
    expect(loadDirConfig(project({ name: "alone", badgeColor: "#112233" })).badgeColor).toBe("#112233");
  });

  // Whole keys, not a deep merge: one key is one intent. A `colors` block assembled from two files
  // is harder to predict than one a reader can see entire.
  it("replaces an object-valued key entirely rather than merging into it", () => {
    const dir = project({ colors: { background: "#000000", cursor: "#ff0000" } }, { colors: { background: "#111111" } });
    expect(loadDirConfig(dir).colors).toEqual({ background: "#111111" });
  });

  // The value has to survive validation like any other. A local file is not a way past the rules.
  it("still validates what the local file said", () => {
    const dir = project({ badgeColor: "#112233" }, { badgeColor: "not-a-colour" });
    expect(loadDirConfig(dir).badgeColor).toBeNull();
  });

  // A relative path means the same thing in both files — they sit in the same directory.
  it("resolves a relative path in the local file against this directory", () => {
    const dir = project({ icon: "shared.png" }, { icon: "local.png" });
    writeFileSync(path.join(dir, "shared.png"), "x");
    writeFileSync(path.join(dir, "local.png"), "x");
    expect(loadDirConfig(dir).icon).toMatchObject({ source: "file", path: path.join(dir, "local.png") });
  });

  // Each file is tolerated on its own, so one broken file does not take the directory's whole
  // configuration down with it — which is the difference between "my colour is wrong" and
  // "everything reverted".
  it("keeps the shared config when the local file is malformed", () => {
    expect(loadDirConfig(project({ name: "survives", badgeColor: "#112233" }, "{ not json")).badgeColor).toBe("#112233");
  });

  it("keeps the local config when the shared file is malformed", () => {
    expect(loadDirConfig(project("{ not json", { badgeColor: "#445566" })).badgeColor).toBe("#445566");
  });

  it("is all-null when neither file exists", () => {
    const dir = makeTempDir("mt-localcfg-empty-");
    dirs.push(dir);
    expect(loadDirConfig(dir).badgeColor).toBeNull();
  });
});

// Writing either file has to recolour the cells. Reloading only on the shared one would leave the
// file a user edits MOST — their own clone's — not applying until a browser reload.
describe("live reload", () => {
  // Resolved, like the sibling cases in dir-config.spec.ts: on Windows "\work\proj" is absolute
  // but drive-LESS, so the function under test answers "D:\work\proj" and a joined expectation
  // never matches it.
  it.each([DIR_CONFIG_FILE, DIR_LOCAL_CONFIG_FILE])("fires for a write to %s", (name) => {
    const dir = path.resolve("/work/proj");
    expect(dirConfigWriteTarget("Write", { file_path: path.join(dir, name) })).toBe(dir);
  });

  it("does not fire for another file in the same directory", () => {
    expect(dirConfigWriteTarget("Write", { file_path: "/work/proj/.mulmoterminal.other.json" })).toBeNull();
  });
});

// Two files means the panel has a new question to answer: not just "is this value in force" but
// "which of the two decided it". A value that disagrees with the file you just edited is usually
// the other file winning, and that is invisible without this.
describe("the settings preview names both files", () => {
  it("reports each path and which keys the local file set", () => {
    const dir = project({ name: "acme", badgeColor: "#112233" }, { badgeColor: "#445566" });
    const detail = dirConfigDetail(dir);
    expect(detail.file).toBe(path.join(dir, DIR_CONFIG_FILE));
    expect(detail.localFile).toBe(path.join(dir, DIR_LOCAL_CONFIG_FILE));
    expect(detail.source.local).toEqual(["badgeColor"]);
    expect(detail.source.applied).toEqual(expect.arrayContaining(["name", "badgeColor"]));
    expect(detail.config.badgeColor).toBe("#445566");
  });

  it("reports no local file when there isn't one", () => {
    const detail = dirConfigDetail(project({ name: "acme" }));
    expect(detail.localFile).toBeNull();
    expect(detail.source.local).toEqual([]);
  });

  // A key only the local file names is still a key of this directory's config — it must be
  // classified, not dropped for having come from the second file.
  it("classifies a key that only the local file sets", () => {
    const detail = dirConfigDetail(project({ name: "acme" }, { badgeColour: "#445566", fontSize: 14 }));
    expect(detail.source.local).toEqual(expect.arrayContaining(["badgeColour", "fontSize"]));
    expect(detail.source.unknown).toContain("badgeColour"); // the misspelling still gets called out
    expect(detail.source.applied).toContain("fontSize");
  });

  it("still answers for a directory whose only file is the local one", () => {
    const detail = dirConfigDetail(project(undefined, { badgeColor: "#445566" }));
    expect(detail.file).toBeNull();
    expect(detail.localFile).not.toBeNull();
    expect(detail.config.badgeColor).toBe("#445566");
  });
});

// The worktree copies what the CLONE looks like, which is the merged answer — its parent is this
// checkout, not the repository in the abstract.
describe("worktree inheritance", () => {
  it("derives from the merged config", async () => {
    const { inheritedWorktreeConfig } = await import("../../../server/config/worktree-dir-config");
    const dir = project({ name: "acme", headerColor: "#2d4ea9" }, { headerColor: "#a92d4e" });
    const derived = inheritedWorktreeConfig(loadDirConfig(dir), 1);
    expect(derived.name).toBe("acme");
    expect(derived.headerColor).not.toBe("#2d4ea9"); // rotated from the LOCAL colour, not the shared one
    mkdirSync(path.join(dir, "unused"), { recursive: true });
  });
});
