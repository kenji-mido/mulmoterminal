import { describe, it, expect } from "vitest";
import { buildGrokArgs } from "../../../server/agents/grok-args.js";

const ID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";

describe("buildGrokArgs", () => {
  it("starts a fresh session under the id this server minted", () => {
    expect(buildGrokArgs({ sessionId: ID, resume: null })).toEqual(["--session-id", ID]);
  });

  it("resumes by id instead of minting", () => {
    expect(buildGrokArgs({ sessionId: ID, resume: OTHER })).toEqual(["--resume", OTHER]);
  });

  // The one that matters. grok reads `--session-id` alongside `--resume` as the name of a FORK
  // (it is only legal there with --fork-session), so sending both would branch the conversation
  // rather than resume it — leaving the user's history behind under the old id.
  it("never sends both id flags", () => {
    const args = buildGrokArgs({ sessionId: ID, resume: OTHER, model: "grok-4.5", skipPermissions: true, initialPrompt: "go" });
    expect(args).toContain("--resume");
    expect(args).not.toContain("--session-id");
    expect(args).not.toContain(ID);
  });

  it("passes a model override and the auto approval mode", () => {
    expect(buildGrokArgs({ sessionId: ID, resume: null, model: "grok-4.5", skipPermissions: true })).toEqual([
      "--session-id",
      ID,
      "--model",
      "grok-4.5",
      "--permission-mode",
      "auto",
    ]);
  });

  it("omits the model and the approval mode when they are not asked for", () => {
    expect(buildGrokArgs({ sessionId: ID, resume: null, model: null, skipPermissions: false })).toEqual(["--session-id", ID]);
  });

  // Positional, so anything after it would be swallowed as part of the prompt text.
  it("puts the seed prompt last", () => {
    const args = buildGrokArgs({ sessionId: ID, resume: null, model: "grok-4.5", skipPermissions: true, initialPrompt: "/collect run" });
    expect(args[args.length - 1]).toBe("/collect run");
  });

  it("omits an empty seed prompt rather than passing an empty positional", () => {
    expect(buildGrokArgs({ sessionId: ID, resume: null, initialPrompt: "" })).toEqual(["--session-id", ID]);
  });
});
