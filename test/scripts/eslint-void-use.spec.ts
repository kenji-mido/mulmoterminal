// @vitest-environment node
import { describe, it, expect } from "vitest";
import { ESLint, Linter } from "eslint";
import { existsSync } from "node:fs";

// `sonarjs/void-use` spent a release off, on the claim that it forbids the `void` that
// no-floating-promises asks for. It does not: S3735 returns early for a thenable — and, with no type
// info, for any call at all — so the 160-odd uses of the operator in server/src/common are invisible
// to it, and turning it on reported three sites that were never promises (#1362).
//
// Only the resolved severity is pinned here. The exclusion itself needs no spec: if a future sonarjs
// dropped it, every one of those sites would go red in `yarn lint` at once, and the repository's own
// source is a better witness than a fixture — a spec would only build a second type program to say it.
const RULE = "sonarjs/void-use";
const ERROR = 2;

// One file per config block that could turn it off again: the type-aware block covers server, src
// and common .ts; `.vue` and everything else take it from sonarjs's recommended set.
const FILES = ["server/session/tmux-size-sync.ts", "src/composables/useDynamicFavicon.ts", "common/toolGroups.ts", "src/components/SettingsField.vue"];

const eslint = new ESLint();

const severityOf = async (file: string): Promise<Linter.RuleSeverity | undefined> => {
  const config = await eslint.calculateConfigForFile(file);
  const entry: Linter.RuleEntry | undefined = config.rules[RULE];
  return Array.isArray(entry) ? entry[0] : entry;
};

describe("the void-use rule", () => {
  it.each(FILES)("is configured at error for %s", async (file) => {
    expect(await severityOf(file)).toBe(ERROR);
  });

  // `calculateConfigForFile` answers from the path patterns alone, so a renamed or deleted file
  // would keep passing above while no longer standing for the block it was chosen to represent.
  it.each(FILES)("still has %s to stand for its config block", (file) => {
    expect(existsSync(file)).toBe(true);
  });
});
