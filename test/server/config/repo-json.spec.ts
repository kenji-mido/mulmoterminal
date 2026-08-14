// @vitest-environment node
// `repo.json` as MulmoTerminal settings (#1442), and where it sits in the stack:
//
//   repo.json  →  .mulmoterminal.json  →  .mulmoterminal.local.json
//   general       this app's own          this checkout
//
// The open file is not a replacement for the other two. It is what a repository says to EVERY
// tool, and what this one falls back on when nothing more specific exists.
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir.js";
import { loadDirConfig, dirConfigDetail, publicDirConfig } from "../../../server/config/dir-config";
import * as configRoutes from "../../../server/config/config-routes";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

// Auto-detection (#1428) is a different feature with its own tests; keep it out of these results.
let autoIcon: ReturnType<typeof vi.spyOn>;
beforeEach(() => (autoIcon = vi.spyOn(configRoutes, "getAutoDirIcon").mockReturnValue(false)));
afterEach(() => autoIcon.mockRestore());

function project(files: Record<string, unknown>): string {
  const dir = makeTempDir("mt-repojson-");
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  }
  return dir;
}

describe("what repo.json contributes", () => {
  it("names the directory", () => {
    expect(loadDirConfig(project({ "repo.json": { name: "diffusion-lab" } })).name).toBe("diffusion-lab");
  });

  // One brand colour, seven painted. The derivation itself is pinned in chromeFromColor.spec.ts;
  // what matters here is that it reaches the resolved config at all.
  it("paints the whole cell from one colour", () => {
    const config = loadDirConfig(project({ "repo.json": { color: "#7c3aed" } }));
    expect(config.headerColor).toBe("#7c3aed");
    expect(config.badgeColor).not.toBeNull();
    expect(config.cellColor).not.toBeNull();
    expect(config.cellBorderColor).toBe(config.dotColor);
    // Never declared, always derived — the specification's rule, reaching the app.
    expect(config.headerTextColor).toBe("#ffffff");
  });

  it("takes `background` as the cell surface", () => {
    expect(loadDirConfig(project({ "repo.json": { color: { primary: "#7c3aed", background: "#0b1020" } } })).cellColor).toBe("#0b1020");
  });

  it("resolves an icon through the same confinement the config key uses", () => {
    const dir = project({ "repo.json": { icon: "assets/logo.png" }, "assets/logo.png": "x" });
    expect(loadDirConfig(dir).icon).toMatchObject({ source: "file", path: path.join(dir, "assets/logo.png") });
  });

  it("takes the best entry of an icon array", () => {
    const dir = project({
      "repo.json": {
        icon: [
          { src: "small.png", sizes: "48x48" },
          { src: "vector.svg", sizes: "any" },
        ],
      },
      "small.png": "x",
      "vector.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
    });
    expect(loadDirConfig(dir).icon).toMatchObject({ ref: "vector.svg" });
  });

  // "Keep going until one RESOLVES" — the specification's rule, and the bug #1429 was about.
  it("skips an icon entry that does not resolve and uses the next", () => {
    const dir = project({
      "repo.json": {
        icon: [
          { src: "gone.png", sizes: "512x512" },
          { src: "here.png", sizes: "64x64" },
        ],
      },
      "here.png": "x",
    });
    expect(loadDirConfig(dir).icon).toMatchObject({ ref: "here.png" });
  });

  it("refuses an icon that escapes the directory", () => {
    const parent = makeTempDir("mt-repojson-parent-");
    dirs.push(parent);
    const dir = path.join(parent, "proj");
    mkdirSync(dir);
    writeFileSync(path.join(parent, "outside.png"), "x");
    writeFileSync(path.join(dir, "repo.json"), JSON.stringify({ icon: "../outside.png" }));
    expect(loadDirConfig(dir).icon).toBeNull();
  });

  it("refuses a symlink pointing outside the directory", () => {
    const parent = makeTempDir("mt-repojson-link-");
    dirs.push(parent);
    const dir = path.join(parent, "proj");
    mkdirSync(dir);
    writeFileSync(path.join(parent, "outside.png"), "x");
    symlinkSync(path.join(parent, "outside.png"), path.join(dir, "logo.png"));
    writeFileSync(path.join(dir, "repo.json"), JSON.stringify({ icon: "logo.png" }));
    expect(loadDirConfig(dir).icon).toBeNull();
  });

  it("passes a remote icon straight through", () => {
    expect(loadDirConfig(project({ "repo.json": { icon: "https://example.com/logo.png" } })).icon).toEqual({
      source: "url",
      url: "https://example.com/logo.png",
    });
  });
});

describe("the extensions entry", () => {
  it("applies this app's own keys from inside the open file", () => {
    const config = loadDirConfig(project({ "repo.json": { extensions: { mulmoterminal: { orderPriority: 20, theme: "nord" } } } }));
    expect(config.orderPriority).toBe(20);
    expect(config.theme).toBe("nord");
  });

  // Same file, more specific statement — so it wins over what `color` implied.
  it("outranks the colours derived from the core fields", () => {
    const config = loadDirConfig(project({ "repo.json": { color: "#7c3aed", extensions: { mulmoterminal: { badgeColor: "#112233" } } } }));
    expect(config.badgeColor).toBe("#112233");
    expect(config.headerColor).toBe("#7c3aed"); // untouched by the extension
  });

  it("ignores another tool's entry", () => {
    expect(loadDirConfig(project({ "repo.json": { extensions: { someoneelse: { orderPriority: 99 } } } })).orderPriority).toBeNull();
  });
});

describe("the layering", () => {
  const REPO = { name: "from-repo", color: "#7c3aed" };

  it("lets .mulmoterminal.json override repo.json", () => {
    const config = loadDirConfig(project({ "repo.json": REPO, ".mulmoterminal.json": { name: "from-shared" } }));
    expect(config.name).toBe("from-shared");
    expect(config.headerColor).toBe("#7c3aed"); // not overridden, so the open file still speaks
  });

  it("lets .mulmoterminal.local.json override both", () => {
    const dir = project({
      "repo.json": REPO,
      ".mulmoterminal.json": { name: "from-shared", headerColor: "#111111" },
      ".mulmoterminal.local.json": { headerColor: "#222222" },
    });
    const config = loadDirConfig(dir);
    expect(config.name).toBe("from-shared");
    expect(config.headerColor).toBe("#222222");
  });

  it("works with repo.json alone", () => {
    expect(publicDirConfig(project({ "repo.json": REPO })).name).toBe("from-repo");
  });

  // Each layer is tolerated on its own: one broken file must not take the others down.
  it("keeps the other layers when repo.json is malformed", () => {
    expect(loadDirConfig(project({ "repo.json": "{ not json", ".mulmoterminal.json": { name: "survives" } })).name).toBe("survives");
  });

  it("ignores a repo.json that is not an object", () => {
    expect(loadDirConfig(project({ "repo.json": [1, 2, 3], ".mulmoterminal.json": { name: "survives" } })).name).toBe("survives");
  });
});

describe("the settings preview", () => {
  it("names repo.json and lists what it offered", () => {
    const dir = project({ "repo.json": { name: "proj", color: "#7c3aed" } });
    const detail = dirConfigDetail(dir);
    expect(detail.repoFile).toBe(path.join(dir, "repo.json"));
    // Including the colours it derived — the panel should show what the layer contributed, not
    // only what the file literally spelled out.
    expect(detail.source.repo).toEqual(expect.arrayContaining(["name", "headerColor", "badgeColor"]));
  });

  it("reports no repo.json when there is none", () => {
    const detail = dirConfigDetail(project({ ".mulmoterminal.json": { name: "proj" } }));
    expect(detail.repoFile).toBeNull();
    expect(detail.source.repo).toEqual([]);
  });
});
