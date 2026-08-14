import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sanitizeButtons, type HeaderContext } from "../../../server/config/header-config";
import { resolveHeader } from "../../../server/config/header-resolve";

const ctx = (o: Partial<HeaderContext> = {}): HeaderContext => ({
  dir: "/x/myrepo",
  dirName: "myrepo",
  branch: "main",
  repo: "receptron/mulmoterminal",
  model: null,
  agent: "claude",
  session: "s",
  remoteUrl: null,
  dirty: 0,
  ahead: 0,
  behind: 0,
  task: null,
  isGitRepo: true,
  prUrl: null,
  worktreeEnv: [],
  ...o,
});

// CLAUDE.md asks that any config sample in the docs be run through its real validator before it
// ships, because a bad one stops a reader's server from starting or — worse — starts it and
// misbehaves. Nothing enforced that. The guides shipped a GitHub button gated on `isGitRepo`, which
// renders a bare `https://github.com/` link in a repo whose remote is not GitHub; the real default
// used `repo != ` and said why in a comment, and only the copy readers actually paste was wrong
// (CodeRabbit, #1382).
//
// Every ```json block in the guides/skill that contains a "buttons" array, through the real validator.
function buttonSamples(file: string): unknown[][] {
  const text = readFileSync(path.join(process.cwd(), file), "utf8");
  const out: unknown[][] = [];
  for (const m of text.matchAll(/```json\n([\s\S]*?)```/g)) {
    const body = m[1];
    if (!body.includes('"buttons"')) continue;
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { buttons?: unknown }).buttons)) {
      out.push((parsed as { buttons: unknown[] }).buttons);
    }
  }
  return out;
}

const FILES = ["docs/guide/en/config.md", "docs/guide/ja/config.md", "server/skills/mulmoterminal-header/SKILL.md"];

describe("documented button samples survive the real validator", () => {
  for (const file of FILES) {
    it(file, () => {
      const samples = buttonSamples(file);
      expect(samples.length).toBeGreaterThan(0);
      for (const raw of samples) {
        const clean = sanitizeButtons(raw);
        if (clean === null) throw new Error(`${file}: sanitizeButtons rejected a sample`);
        expect(clean.length, `${file}: sanitizeButtons dropped entries`).toBe(raw.length);
        // A gh-style button must not render a bare https://github.com/ when the remote isn't GitHub.
        const noRepo = resolveHeader({ buttons: clean, chips: null }, ctx({ repo: null })).buttons;
        expect(
          noRepo.some((b) => b.open?.url === "https://github.com/"),
          `${file}: bare github.com/ link`,
        ).toBe(false);
      }
    });
  }
});
