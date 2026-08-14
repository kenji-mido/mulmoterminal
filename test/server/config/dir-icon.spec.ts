// @vitest-environment node
import { describe, it, expect } from "vitest";
import { makeTempDir } from "../../support/tempDir.js";
import { writeFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { resolveDirIcon, dirIconRef } from "../../../server/config/dir-icon";
import { loadDirConfig, publicDirConfig } from "../../../server/config/dir-config";
import { DIR_ICON_MAX_CHARS } from "../../../common/dirIcon";

const tmp = () => makeTempDir("mt-diricon-");

function withIcon(icon: unknown): { dir: string; cleanup: () => void } {
  const dir = tmp();
  writeFileSync(path.join(dir, "logo.png"), "x");
  writeFileSync(path.join(dir, ".mulmoterminal.json"), JSON.stringify({ icon }));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Since #1428 a refusal is `"invalid"`, not null: the file DID name something, and null is
// reserved for "said nothing" — the only state that lets the repository's own favicon be picked
// up instead. Asserted as the exact value below; `toBeNull()` would now pass for a bug that
// silently made a broken path auto-detect.
const REFUSED = "invalid";

describe("resolveDirIcon — files inside the directory", () => {
  it("resolves a relative path, keeping the reference as written", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "logo.png"), "x");
    expect(resolveDirIcon(dir, "./logo.png")).toEqual({ source: "file", path: path.join(dir, "logo.png"), ref: "./logo.png", mime: "image/png" });
    expect(resolveDirIcon(dir, "logo.png")).toEqual({ source: "file", path: path.join(dir, "logo.png"), ref: "logo.png", mime: "image/png" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("allows a file in a subdirectory, and an animated gif", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "docs"));
    writeFileSync(path.join(dir, "docs", "spin.gif"), "x");
    expect(resolveDirIcon(dir, "docs/spin.gif")).toMatchObject({ source: "file", mime: "image/gif" });
    rmSync(dir, { recursive: true, force: true });
  });

  // The same confinement `sound` has, and for the same reason: a project this app opens must not
  // be able to point it at files elsewhere on the machine.
  it("refuses an absolute path and an escape via ..", () => {
    const parent = tmp();
    const dir = path.join(parent, "proj");
    mkdirSync(dir);
    writeFileSync(path.join(parent, "outside.png"), "x");
    expect(resolveDirIcon(dir, path.join(parent, "outside.png"))).toBe(REFUSED);
    expect(resolveDirIcon(dir, "../outside.png")).toBe(REFUSED);
    rmSync(parent, { recursive: true, force: true });
  });

  // The lexical check alone passes here — the string never leaves the directory. Only the
  // realpath re-check catches it.
  it("refuses a symlink pointing outside cwd", () => {
    const parent = tmp();
    const dir = path.join(parent, "proj");
    mkdirSync(dir);
    writeFileSync(path.join(parent, "outside.png"), "x");
    symlinkSync(path.join(parent, "outside.png"), path.join(dir, "link.png"));
    expect(resolveDirIcon(dir, "./link.png")).toBe(REFUSED);
    rmSync(parent, { recursive: true, force: true });
  });

  it("refuses a file that isn't there, a directory, and a non-image extension", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "notes.md"), "x");
    expect(resolveDirIcon(dir, "./missing.png")).toBe(REFUSED);
    expect(resolveDirIcon(dir, "./assets")).toBe(REFUSED);
    expect(resolveDirIcon(dir, "./notes.md")).toBe(REFUSED);
    rmSync(dir, { recursive: true, force: true });
  });

  // `undefined` is the ONE input that means "said nothing" — the key is absent. Everything else
  // here is a key someone wrote and got wrong, which must not fall through to auto-detection.
  it("separates an absent key from a key written wrong", () => {
    const dir = tmp();
    expect(resolveDirIcon(dir, undefined)).toBeNull();
    [42, null, {}, "", "   "].forEach((input) => expect(resolveDirIcon(dir, input)).toBe(REFUSED));
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("resolveDirIcon — remote sources", () => {
  it.each(["https://example.com/logo.png", "http://localhost:9000/logo.gif", "data:image/png;base64,AAAA"])("passes %s through", (url) => {
    const dir = tmp();
    expect(resolveDirIcon(dir, url)).toEqual({ source: "url", url });
    rmSync(dir, { recursive: true, force: true });
  });

  // Not a remote source and not a relative path either, so it falls through to the file branch
  // and is refused there — which is what keeps `file:` from ever reaching the browser.
  it.each(["file:///etc/passwd", "javascript:alert(1)", "data:text/html,<b>x</b>"])("refuses %s", (url) => {
    const dir = tmp();
    expect(resolveDirIcon(dir, url)).toBe(REFUSED);
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses a value past the length cap", () => {
    const dir = tmp();
    expect(resolveDirIcon(dir, `data:image/png;base64,${"A".repeat(DIR_ICON_MAX_CHARS)}`)).toBe(REFUSED);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("dirIconRef", () => {
  it("gives back what a config file would have to say to mean this icon again", () => {
    expect(dirIconRef({ source: "file", path: "/proj/logo.png", ref: "logo.png", mime: "image/png" })).toBe("logo.png");
    expect(dirIconRef({ source: "url", url: "https://x/y.png" })).toBe("https://x/y.png");
    expect(dirIconRef(null)).toBeNull();
  });
});

describe("publicDirConfig.iconUrl", () => {
  it("hands the browser this app's route for a file, never the path", () => {
    const { dir, cleanup } = withIcon("./logo.png");
    const url = publicDirConfig(dir).iconUrl;
    expect(url).toBe(`/api/dir-icon?cwd=${encodeURIComponent(dir)}`);
    expect(url).not.toContain("logo.png");
    // The resolved path stays on the server, exactly like the attention sound's.
    expect(loadDirConfig(dir).icon).toMatchObject({ source: "file", path: path.join(dir, "logo.png") });
    cleanup();
  });

  it("hands a remote URL straight through — the browser fetches it, not us", () => {
    const { dir, cleanup } = withIcon("https://example.com/logo.png");
    expect(publicDirConfig(dir).iconUrl).toBe("https://example.com/logo.png");
    cleanup();
  });

  it("is null when the directory sets no icon, or an unusable one", () => {
    const unset = withIcon(undefined);
    expect(publicDirConfig(unset.dir).iconUrl).toBeNull();
    unset.cleanup();
    const bad = withIcon("../../../etc/passwd");
    expect(publicDirConfig(bad.dir).iconUrl).toBeNull();
    bad.cleanup();
  });
});
