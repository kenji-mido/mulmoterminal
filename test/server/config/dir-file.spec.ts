// @vitest-environment node
//
// The containment rule a directory's own config is held to, and — the point of this file — the
// fact that BOTH keys that name a file are held to the same one.
//
// `icon` was written by copying `sound`'s four checks, which is how a rule ends up fixed on one
// side and not the other: each caller's own spec would still be green while the two disagreed
// about what escapes. So the pairs below assert the two answers TOGETHER.
import { describe, it, expect } from "vitest";
import { makeTempDir } from "../../support/tempDir.js";
import { writeFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { resolveFileWithinDir } from "../../../server/config/dir-file";
import { resolveDirSound } from "../../../server/config/dir-config";
import { resolveIconFile } from "../../../server/config/dir-icon";

const tmp = () => makeTempDir("mt-dirfile-");

// A .png so the icon side gets past its own extension check and both callers are really being
// asked the same question — containment, not "is this an image".
const IMAGE = "logo.png";

/** What each caller answers for `ref`, as one value: null / null when the rule refuses. */
const bothAnswers = (dir: string, ref: string): { sound: string | null; icon: string | null } => ({
  sound: resolveDirSound(dir, ref),
  icon: resolveIconFile(dir, ref)?.path ?? null,
});

describe("resolveFileWithinDir", () => {
  it("resolves a relative path, including into a subdirectory", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "assets", IMAGE), "x");
    expect(resolveFileWithinDir(dir, `assets/${IMAGE}`)).toBe(path.join(dir, "assets", IMAGE));
    expect(resolveFileWithinDir(dir, `./assets/${IMAGE}`)).toBe(path.join(dir, "assets", IMAGE));
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses an absolute path and an escape via ..", () => {
    const parent = tmp();
    const dir = path.join(parent, "proj");
    mkdirSync(dir);
    writeFileSync(path.join(parent, IMAGE), "x");
    expect(resolveFileWithinDir(dir, path.join(parent, IMAGE))).toBeNull();
    expect(resolveFileWithinDir(dir, `../${IMAGE}`)).toBeNull();
    rmSync(parent, { recursive: true, force: true });
  });

  // The lexical check alone passes here — the string never leaves the directory. Only the realpath
  // re-check catches it, which is why the rule is four checks and not three.
  it("refuses a symlink inside the directory that points out of it", () => {
    const parent = tmp();
    const dir = path.join(parent, "proj");
    mkdirSync(dir);
    writeFileSync(path.join(parent, IMAGE), "x");
    symlinkSync(path.join(parent, IMAGE), path.join(dir, IMAGE));
    expect(resolveFileWithinDir(dir, IMAGE)).toBeNull();
    rmSync(parent, { recursive: true, force: true });
  });

  it("refuses what is not a file: a missing path, and a directory", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "assets"));
    expect(resolveFileWithinDir(dir, IMAGE)).toBeNull();
    expect(resolveFileWithinDir(dir, "assets")).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("`sound` and `icon` are confined by the same rule", () => {
  it("both resolve a file that really is inside the directory", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, IMAGE), "x");
    expect(bothAnswers(dir, `./${IMAGE}`)).toEqual({ sound: path.join(dir, IMAGE), icon: path.join(dir, IMAGE) });
    rmSync(dir, { recursive: true, force: true });
  });

  it("both refuse an absolute path, a .. escape, and an outward symlink", () => {
    const parent = tmp();
    const dir = path.join(parent, "proj");
    mkdirSync(dir);
    writeFileSync(path.join(parent, IMAGE), "x");
    symlinkSync(path.join(parent, IMAGE), path.join(dir, "link.png"));
    const refused = { sound: null, icon: null };
    expect(bothAnswers(dir, path.join(parent, IMAGE))).toEqual(refused);
    expect(bothAnswers(dir, `../${IMAGE}`)).toEqual(refused);
    expect(bothAnswers(dir, "./link.png")).toEqual(refused);
    rmSync(parent, { recursive: true, force: true });
  });
});
