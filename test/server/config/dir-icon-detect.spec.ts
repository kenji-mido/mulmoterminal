// @vitest-environment node
// Picking up the favicon a repository already ships (#1428). The candidate list was measured, not
// guessed — 26 of 157 repositories on the author's machine had one, all under `public/` — so what
// these pin is the ORDER (which of several wins) and the boundary (what the search must refuse).
import { describe, it, expect } from "vitest";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir.js";
import { detectDirIcon } from "../../../server/config/dir-icon-detect";

const dirs: string[] = [];
const project = (files: Record<string, string>): string => {
  const dir = makeTempDir("mt-autoicon-");
  dirs.push(dir);
  Object.entries(files).forEach(([name, body]) => {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), body);
  });
  return dir;
};
const cleanup = () => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
// A `ref` is a config value, so it is spelled with "/" on every platform — never `path.join`,
// which would assert `public\favicon.png` on Windows and pass there for a value no config file
// should ever carry.
const refOf = (dir: string): string | null => {
  const icon = detectDirIcon(dir);
  return icon?.source === "file" ? icon.ref : null;
};

describe("detectDirIcon — which file wins", () => {
  // Ordered by how the image survives being drawn at 14px, not by how common it is: a vector is
  // exact at any size, an apple-touch icon is real artwork, a .ico is often a 16px bitmap.
  it("prefers svg, then apple-touch, then png, then ico", () => {
    const all = project({
      "public/favicon.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
      "public/apple-touch-icon.png": "x",
      "public/favicon.png": "x",
      "public/favicon.ico": "x",
    });
    expect(refOf(all)).toBe("public/favicon.svg");
    expect(refOf(project({ "public/apple-touch-icon.png": "x", "public/favicon.png": "x", "public/favicon.ico": "x" }))).toBe("public/apple-touch-icon.png");
    expect(refOf(project({ "public/favicon.png": "x", "public/favicon.ico": "x" }))).toBe("public/favicon.png");
    expect(refOf(project({ "public/favicon.ico": "x" }))).toBe("public/favicon.ico");
    cleanup();
  });

  // `public/` before the root within each pair: every one of the 26 repositories measured kept
  // its icon there, and none had one at the root.
  it("prefers public/ over the repository root", () => {
    expect(refOf(project({ "public/favicon.ico": "x", "favicon.ico": "x" }))).toBe("public/favicon.ico");
    expect(refOf(project({ "favicon.ico": "x" }))).toBe("favicon.ico");
    cleanup();
  });

  // Deliberately NOT searched: `docs/logo.png` and friends were 0 of 157, and a "logo" is as often
  // a wide README banner as an icon — which would look wrong squeezed into 14 square pixels.
  it("ignores a logo that is not a favicon", () => {
    expect(detectDirIcon(project({ "docs/logo.png": "x", "assets/logo.svg": "x", "logo.png": "x" }))).toBeNull();
    cleanup();
  });

  // Regression (Codex + CodeRabbit on #1429): the search used to stop at the first path that
  // EXISTED, so one unusable high-priority entry buried every good one behind it.
  it("keeps looking when a higher-priority candidate exists but is unusable", () => {
    const parent = makeTempDir("mt-autoicon-shadow-");
    dirs.push(parent);
    const dir = path.join(parent, "proj");
    mkdirSync(path.join(dir, "public"), { recursive: true });
    // A directory where an icon should be, and a symlink that escapes the repository — both exist,
    // neither is usable.
    mkdirSync(path.join(dir, "public", "favicon.svg"));
    writeFileSync(path.join(parent, "outside.png"), "x");
    symlinkSync(path.join(parent, "outside.png"), path.join(dir, "public", "apple-touch-icon.png"));
    writeFileSync(path.join(dir, "public", "favicon.png"), "x");
    expect(refOf(dir)).toBe("public/favicon.png");
    cleanup();
  });

  // The same rule at the boundary between the file list and the manifest.
  it("falls through to the manifest when every candidate is unusable", () => {
    const dir = project({
      "public/manifest.json": JSON.stringify({ icons: [{ src: "real.png", sizes: "192x192" }] }),
      "public/real.png": "x",
    });
    mkdirSync(path.join(dir, "public", "favicon.ico"));
    expect(refOf(dir)).toBe("public/real.png");
    cleanup();
  });

  it("finds nothing in a directory that has nothing", () => {
    expect(detectDirIcon(project({ "README.md": "# hi" }))).toBeNull();
    cleanup();
  });
});

describe("detectDirIcon — the web manifest", () => {
  const manifest = (icons: unknown) => JSON.stringify({ name: "p", icons });

  // Last resort, and the only candidate that costs a parse — so a plain file must win first.
  it("is read only when no plain file matched", () => {
    const both = project({
      "public/favicon.ico": "x",
      "public/site.webmanifest": manifest([{ src: "big.png", sizes: "512x512" }]),
      "public/big.png": "x",
    });
    expect(refOf(both)).toBe("public/favicon.ico");
    cleanup();
  });

  it("takes the largest declared size", () => {
    const dir = project({
      "public/manifest.json": manifest([
        { src: "small.png", sizes: "48x48" },
        { src: "big.png", sizes: "512x512" },
        { src: "mid.png", sizes: "192x192" },
      ]),
      "public/small.png": "x",
      "public/big.png": "x",
      "public/mid.png": "x",
    });
    expect(refOf(dir)).toBe("public/big.png");
    cleanup();
  });

  // A maskable icon carries a safe-zone margin, so drawn unmasked it reads as shrunken. Kept as a
  // fallback rather than dropped — an icon with padding beats no icon.
  it("puts a maskable icon behind a plain one, but still uses it alone", () => {
    const both = project({
      "public/manifest.json": manifest([
        { src: "mask.png", sizes: "512x512", purpose: "maskable" },
        { src: "plain.png", sizes: "192x192" },
      ]),
      "public/mask.png": "x",
      "public/plain.png": "x",
    });
    expect(refOf(both)).toBe("public/plain.png");
    const only = project({ "public/manifest.json": manifest([{ src: "mask.png", sizes: "512x512", purpose: "maskable" }]), "public/mask.png": "x" });
    expect(refOf(only)).toBe("public/mask.png");
    cleanup();
  });

  it("prefers a vector, which declares sizes as `any`", () => {
    const dir = project({
      "public/manifest.json": manifest([
        { src: "raster.png", sizes: "512x512" },
        { src: "vector.svg", sizes: "any" },
      ]),
      "public/raster.png": "x",
      "public/vector.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
    });
    expect(refOf(dir)).toBe("public/vector.svg");
    cleanup();
  });

  // A leading `/` is site-root-relative, and for a manifest in `public/` the web root IS that
  // directory. Resolving it against the checkout instead would miss every Vite project.
  it("resolves a root-relative src against the manifest's own directory", () => {
    const dir = project({ "public/site.webmanifest": manifest([{ src: "/pwa-192.png", sizes: "192x192" }]), "public/pwa-192.png": "x" });
    expect(refOf(dir)).toBe("public/pwa-192.png");
    cleanup();
  });

  // The written key may name an http(s) URL because the user typed it. A manifest we went looking
  // for must not make the browser fetch somebody else's host uninvited.
  it("refuses a remote src, and falls through to the next entry", () => {
    const dir = project({
      "public/manifest.json": manifest([
        { src: "https://cdn.example.com/icon.png", sizes: "512x512" },
        { src: "//cdn.example.com/icon.png", sizes: "512x512" },
        { src: "local.png", sizes: "64x64" },
      ]),
      "public/local.png": "x",
    });
    expect(refOf(dir)).toBe("public/local.png");
    cleanup();
  });

  it("refuses a src that escapes the directory", () => {
    const parent = makeTempDir("mt-autoicon-parent-");
    dirs.push(parent);
    const dir = path.join(parent, "proj");
    mkdirSync(path.join(dir, "public"), { recursive: true });
    writeFileSync(path.join(parent, "outside.png"), "x");
    writeFileSync(path.join(dir, "public", "manifest.json"), manifest([{ src: "../../outside.png", sizes: "512x512" }]));
    expect(detectDirIcon(dir)).toBeNull();
    cleanup();
  });

  it("refuses a symlink pointing outside the directory", () => {
    const parent = makeTempDir("mt-autoicon-link-");
    dirs.push(parent);
    const dir = path.join(parent, "proj");
    mkdirSync(path.join(dir, "public"), { recursive: true });
    writeFileSync(path.join(parent, "outside.png"), "x");
    symlinkSync(path.join(parent, "outside.png"), path.join(dir, "public", "favicon.png"));
    expect(detectDirIcon(dir)).toBeNull();
    cleanup();
  });

  it("survives a malformed manifest, a non-array icons, and entries that are not objects", () => {
    expect(detectDirIcon(project({ "public/manifest.json": "{ not json" }))).toBeNull();
    expect(detectDirIcon(project({ "public/manifest.json": JSON.stringify({ icons: "nope" }) }))).toBeNull();
    expect(detectDirIcon(project({ "public/manifest.json": manifest([null, 42, {}, { src: "" }]) }))).toBeNull();
    cleanup();
  });

  // The entry points at a file the repository does not actually have — common when a manifest
  // outlives a rename. It must not stop the next entry from being tried.
  it("skips an entry whose file is missing", () => {
    const dir = project({
      "public/manifest.json": manifest([
        { src: "gone.png", sizes: "512x512" },
        { src: "here.png", sizes: "64x64" },
      ]),
      "public/here.png": "x",
    });
    expect(refOf(dir)).toBe("public/here.png");
    cleanup();
  });
});
