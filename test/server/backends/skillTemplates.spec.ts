// @vitest-environment node
//
// The two app templates the skill hands an LLM, run through the REAL gate.
//
// A template is copied verbatim by an agent that cannot check it, into a
// repository where the first feedback is a deploy. Every failure mode this
// declaration language has — a field name that misses, a role with nothing to
// compare, a window that can never open — is silent at the point of copying
// and fatal afterwards. So the samples are held to the same refusals a real
// `check` applies, which is the only way a sample stays true as the rules move.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CollectionSchema } from "@mulmoclaude/core/collection";
import { declarationProblems } from "../../../server/backends/sharedApp/context.js";
import { parseAuthoredApp } from "@mulmoclaude/core/collection/server";

const TEMPLATES = path.join(process.cwd(), "server", "skills", "mulmoterminal-shared-app", "templates");

/** The JSON blocks of one template, keyed by the heading above them. The
 *  headings are the file paths an author writes, so the mapping is the
 *  template's own instruction rather than an ordering this test invented. */
function blocksOf(file: string): Map<string, unknown> {
  const text = readFileSync(path.join(TEMPLATES, file), "utf8");
  const blocks = new Map<string, unknown>();
  const pattern = /^## (.+?)\n\n```json\n([\s\S]*?)\n```/gm;
  for (const [, heading, json] of text.matchAll(pattern)) {
    if (heading === undefined || json === undefined) continue;
    blocks.set(heading.trim(), JSON.parse(json));
  }
  return blocks;
}

/** An ordinary shared collection the template mentions but does not spell out —
 *  a staff list, a price list. Their shape teaches nothing, and leaving them
 *  undeclared here would make the roster's per-collection roles look like
 *  typos. */
const plain = (slug: string): CollectionSchema => ({
  title: slug,
  icon: "list",
  primaryKey: "id",
  storage: { type: "firestore" },
  fields: { id: { type: "string", label: "ID", primary: true, required: true } },
});

function problemsFor(file: string, owner: string, extraCids: readonly string[]) {
  const blocks = blocksOf(file);
  const manifest = blocks.get("app.json");
  expect(manifest, `${file} must show an \`## app.json\` block`).toBeTruthy();
  // The `aid` in a template is prose on purpose — `init` mints it, and a
  // sample carrying a real one invites an agent to paste somebody's app id.
  const parsed = parseAuthoredApp(JSON.stringify({ ...(manifest as object), aid: "app_template" }));
  if (!parsed.ok) throw new Error(`${file}: app.json does not parse — ${parsed.problems.join("; ")}`);

  const collections = [
    ...[...blocks.entries()]
      .filter(([heading]) => heading.endsWith("/schema.json"))
      .map(([heading, schema]) => ({ slug: heading.split("/").at(-2) ?? heading, schema: schema as CollectionSchema })),
    ...extraCids.map((slug) => ({ slug, schema: plain(slug) })),
  ];
  return declarationProblems(parsed.app, collections as never, { email: owner, uid: "u-owner" });
}

describe("the shared-app templates", () => {
  it("salon.md deploys as written", () => {
    expect(problemsFor("salon.md", "owner@salon.jp", ["stylists", "services"])).toEqual([]);
  });

  it("gym.md deploys as written", () => {
    expect(problemsFor("gym.md", "owner@gym.jp", [])).toEqual([]);
  });

  it("each template shows every collection whose shape carries a decision", () => {
    // A guard on the guard: if a template stopped showing its schemas the
    // checks above would still pass, against nothing.
    expect([...blocksOf("salon.md").keys()]).toEqual(expect.arrayContaining([".claude/skills/bookings/schema.json", ".claude/skills/slots/schema.json"]));
    expect([...blocksOf("gym.md").keys()]).toEqual(expect.arrayContaining([".claude/skills/classes/schema.json", ".claude/skills/bookings/schema.json"]));
  });
});
