// The id shape itself. The path tests (dir-model-choice, launch-choice) prove the rule is
// still APPLIED at each entry point; this one pins what the rule says — in particular the
// one place a model id and a provider id deliberately disagree.
import { describe, it, expect } from "vitest";
import { isUsableModelId, isUsableProviderId, MODEL_ID_ALLOWED, MODEL_ID_MAX_LENGTH } from "../../common/modelIds";

describe("Claude Code's [1m] extended-context suffix (#1503)", () => {
  // Every form the official docs show. An alias carries it as readily as a full name, and
  // `opusplan[1m]` is documented too — so this is not "a claude-* prefix plus brackets".
  // https://code.claude.com/docs/en/model-config#extended-context
  it.each(["claude-opus-5[1m]", "claude-opus-4-8[1m]", "opus[1m]", "sonnet[1m]", "opusplan[1m]"])("accepts %s as a model id", (model) => {
    expect(isUsableModelId(model)).toBe(true);
  });

  // Bare brackets are not a licence for brackets anywhere: `[1m]` is a suffix on a NAME, so
  // there has to be a name in front of it and nothing behind it.
  it.each([
    ["nothing in front of the suffix", "[1m]"],
    ["the suffix in the middle", "claude[1m]-opus-5"],
    ["a space before the suffix", "claude-opus-5 [1m]"],
    ["the suffix twice", "claude-opus-5[1m][1m]"],
    ["a bracket that opens and never closes", "claude-opus-5[1m"],
  ])("refuses %s", (_why, model) => {
    expect(isUsableModelId(model)).toBe(false);
  });

  // A literal, not a `[\d+[a-z]]` class — the docs define exactly one bracketed suffix, and
  // guessing at a family of them would accept ids Claude Code has no meaning for.
  it.each(["claude-opus-5[2m]", "claude-opus-5[1M]", "claude-opus-5[200k]", "claude-opus-5[1m ]"])("refuses the invented suffix in %s", (model) => {
    expect(isUsableModelId(model)).toBe(false);
  });

  // A provider `id` is a key the user invents for their own `providers[]` entry and reaches
  // no CLI, so the suffix is meaningless there. Accepting it would let the config schema and
  // the ws query disagree about what a provider is called.
  it("is a model-id allowance only — a provider id still refuses it", () => {
    expect(isUsableProviderId("openrouter")).toBe(true);
    expect(isUsableProviderId("openrouter[1m]")).toBe(false);
  });

  // The suffix is four characters that end up in argv like any other, so it is measured.
  it("counts the suffix against the length limit", () => {
    const room = MODEL_ID_MAX_LENGTH - "[1m]".length;
    expect(isUsableModelId(`${"m".repeat(room)}[1m]`)).toBe(true);
    expect(isUsableModelId(`${"m".repeat(room + 1)}[1m]`)).toBe(false);
  });

  it("says so in the sentence a refusal is written from", () => {
    expect(MODEL_ID_ALLOWED).toContain("[1m]");
  });
});

// The half that did not change. Kept here beside the new allowance because a suffix rule
// implemented by loosening the base shape would pass every test above and quietly let a
// space or a leading dash through with it.
describe("the base id shape both kinds share", () => {
  it.each(["moonshotai/kimi-k2.7-code", "z-ai/glm-5.2", "~anthropic/claude-opus-latest", "gpt-5.6-luna-pro"])("still accepts %s", (id) => {
    expect(isUsableModelId(id)).toBe(true);
    expect(isUsableProviderId(id)).toBe(true);
  });

  it.each([
    ["a leading dash argv would read as a flag", "--mcp-config=/tmp/evil.json"],
    ["an embedded space", "kimi k2"],
    ["a newline", "kimi\nrm -rf /"],
    ["a NUL byte", "kimi\u0000"],
    ["the pipe the picker separates on", "openrouter|kimi"],
    ["nothing at all", ""],
  ])("still refuses %s, for either kind", (_why, id) => {
    expect(isUsableModelId(id)).toBe(false);
    expect(isUsableProviderId(id)).toBe(false);
  });
});
