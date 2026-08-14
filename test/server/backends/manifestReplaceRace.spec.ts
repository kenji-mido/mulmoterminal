// @vitest-environment node
//
// `updateManifest` refuses to land on bytes it did not read.
//
// The serialization it has is per-PROCESS: two operations in this server cannot interleave, and
// nothing else is held back at all. `app.json` is a committed file — a checkout, a rebase or an
// editor can replace it between the read and the rename, and the rename would then overwrite that
// newer file with a decision made about the old one. For `fork`, whose whole refusal is "this is
// not your app", the newer bytes could be an app that IS yours.
//
// The mutation itself is the window: it runs after the read and before the write, so a mutation
// that writes to the same path is exactly the interleaving, deterministically.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { updateManifest } from "../../../server/backends/sharedApp/manifestWrite.js";
import { makeTempDir } from "../../support/tempDir";

describe("updateManifest against a file replaced under it", () => {
  let root: string;
  let manifestPath: string;

  beforeEach(() => {
    root = makeTempDir("mt-manifest-race-");
    manifestPath = path.join(root, "app.json");
    writeFileSync(manifestPath, `${JSON.stringify({ aid: "theirs", members: { "author@example.com": { "*": "owner" } } }, null, 2)}\n`);
  });

  it("refuses, and leaves the replacement in place", async () => {
    const replacement = `${JSON.stringify({ aid: "mine", members: { "me@example.com": { "*": "owner" } } }, null, 2)}\n`;

    const result = await updateManifest(root, (manifest) => {
      // Somebody else's write, landing between this update's read and its rename.
      writeFileSync(manifestPath, replacement);
      return { ...manifest, name: "forked" };
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems.join(" ")).toContain("changed on disk while this was being written");
    // The point: the newer file survives. Overwriting it would discard whatever wrote it.
    expect(readFileSync(manifestPath, "utf-8")).toBe(replacement);
  });

  it("still writes when nothing else touched the file", async () => {
    const result = await updateManifest(root, (manifest) => ({ ...manifest, name: "forked" }));

    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(manifestPath, "utf-8")).name).toBe("forked");
  });

  // A mutation that declines to write is not a race — nothing was going to be replaced.
  it("reports no write when the mutation returns null", async () => {
    const result = await updateManifest(root, () => null);

    expect(result.ok).toBe(true);
    expect(result.ok && result.written).toBe(false);
  });
});
