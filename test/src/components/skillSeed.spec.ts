import { describe, it, expect } from "vitest";
import { skillSeed } from "../../../src/components/skillSeed.js";
import { BUNDLED_SKILL_NAMES, DIR_CONFIG_SKILL } from "../../../common/bundledSkills.js";

describe("skillSeed", () => {
  it("uses claude's /<slug> command for claude", () => {
    expect(skillSeed("mulmoterminal-config", "claude")).toBe("/mulmoterminal-config");
  });

  it("names the skill in natural language for codex (no slash command)", () => {
    expect(skillSeed("mulmoterminal-config", "codex")).toBe('Use the "mulmoterminal-config" skill.');
    // Claude is the exception, not the rule: an agent without slash commands gets the sentence.
    expect(skillSeed("mulmoterminal-config", "antigravity")).toBe('Use the "mulmoterminal-config" skill.');
  });
});

// Which skill the generated `.mulmoterminal.json` JSON Schema is installed beside. Naming a skill
// that doesn't ship puts the schema nowhere, with no error at any point — the installer just
// copies the directories it was given.
describe("DIR_CONFIG_SKILL", () => {
  it("names a skill that is bundled", () => {
    expect(BUNDLED_SKILL_NAMES.some((name) => name === DIR_CONFIG_SKILL)).toBe(true);
  });

  it("is the skill that writes that file, not the router", () => {
    expect(DIR_CONFIG_SKILL).toBe("mulmoterminal-dirs");
  });
});
