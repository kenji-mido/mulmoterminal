// The id has one job: change when the client bundle changes, and NOT otherwise. Both halves
// matter — an id that never changes leaves a stale tab silent, and one that changes on every
// restart cries "reload" at a user whose code is already current, which is how a prompt earns
// being ignored.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildIdOf, readBuildId } from "./build-id.js";

const INDEX = '<!doctype html><script type="module" src="/assets/index-CKY72M8G.js"></script>';

describe("buildIdOf", () => {
  it("is the same for the same html", () => {
    expect(buildIdOf(INDEX)).toBe(buildIdOf(INDEX));
  });

  // Vite hashes the asset filename, so a changed bundle changes index.html.
  it("changes when the bundle it loads changes", () => {
    expect(buildIdOf(INDEX)).not.toBe(buildIdOf(INDEX.replace("CKY72M8G", "DIFFERENT")));
  });

  it("is short enough to pass around", () => {
    expect(buildIdOf(INDEX)).toHaveLength(16);
  });
});

describe("readBuildId", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "mt-build-id-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("names the built client", async () => {
    await fs.writeFile(path.join(dir, "index.html"), INDEX);
    expect(readBuildId(dir)).toBe(buildIdOf(INDEX));
  });

  // `yarn dev`: Vite serves the client and reloads it itself, so there is nothing to compare and
  // nothing to say.
  it("is null when there is no built client", () => {
    expect(readBuildId(path.join(dir, "nope"))).toBeNull();
  });
});
