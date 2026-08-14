// @vitest-environment node
// The create path for a NEW presentDocument document. What matters here is that a
// filename already on disk is never written through: the write used to be a plain
// writeFile, so a generated name that collided replaced the older document and still
// reported success (#1623).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDoc, initMarkdownBackend } from "../../../server/backends/markdown.js";
import { DOCS_DIR } from "../../../server/backends/docPath.js";

let ws: string;
const tempDirs: string[] = [];

beforeEach(() => {
  ws = mkdtempSync(path.join(tmpdir(), "mt-createdoc-"));
  tempDirs.push(ws);
  initMarkdownBackend({ workspace: ws });
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const read = (rel: string): string => readFileSync(path.join(ws, rel), "utf8");

/** Returns each id in turn, then repeats the last one forever. */
function sequence(...ids: string[]): () => string {
  let index = 0;
  return () => ids[Math.min(index++, ids.length - 1)] ?? "";
}

describe("createDoc", () => {
  it("writes the document under the dated documents directory", async () => {
    const rel = await createDoc("Design Review", "# hello");
    expect(rel).toMatch(new RegExp(`^${DOCS_DIR}/\\d{4}/\\d{2}/design-review-[0-9a-f]{16}\\.md$`));
    expect(read(rel)).toBe("# hello");
  });

  it("re-rolls past a taken name instead of overwriting the document that holds it", async () => {
    const first = await createDoc("notes", "original", sequence("aaaaaaaaaaaaaaaa"));
    const second = await createDoc("notes", "newcomer", sequence("aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"));

    expect(second).not.toBe(first);
    expect(read(first)).toBe("original");
    expect(read(second)).toBe("newcomer");
  });

  it("fails loudly when every generated name is taken, leaving the existing document alone", async () => {
    const only = sequence("cccccccccccccccc");
    const first = await createDoc("notes", "original", only);

    await expect(createDoc("notes", "newcomer", sequence("cccccccccccccccc"))).rejects.toThrow(/names were all taken/);
    expect(read(first)).toBe("original");
  });

  it("generates a distinct id per document", async () => {
    const paths = await Promise.all(Array.from({ length: 50 }, () => createDoc("same-title", "body")));
    expect(new Set(paths).size).toBe(50);
  });
});
