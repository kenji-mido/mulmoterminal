import { describe, it, expect } from "vitest";
import { buildMuseArgs } from "../../../server/agents/muse-args.js";

const ID = "11111111-2222-4333-8444-555555555555";
const CWD = "/Users/dev/project";

describe("buildMuseArgs", () => {
  it("starts a fresh session in the workspace", () => {
    expect(buildMuseArgs({ workspace: CWD })).toEqual(["--yolo", "--workspace", CWD]);
  });

  it("resumes a session by id", () => {
    expect(buildMuseArgs({ resume: ID, workspace: CWD })).toEqual(["--yolo", "--workspace", CWD, "resume", ID]);
  });

  // The one that matters. `--workspace` is what registers the policy-gated workspace tools, and
  // muse takes root options on either side of the subcommand — so dropping it on the resume path
  // brought the conversation back without the tools it had been using.
  it("keeps the workspace on a resume", () => {
    const args = buildMuseArgs({ resume: ID, workspace: CWD, model: "muse-spark-1.2-contributor" });
    expect(args).toContain("--workspace");
    expect(args[args.indexOf("--workspace") + 1]).toBe(CWD);
    expect(args).toContain("--model");
  });

  // Root options first, then the subcommand and its argument — the form the CLI documents.
  it("puts the resume subcommand and its id last", () => {
    const args = buildMuseArgs({ resume: ID, workspace: CWD, model: "m", reasoningEffort: "high" });
    expect(args.slice(-2)).toEqual(["resume", ID]);
  });

  it("passes a model and a reasoning effort when they are asked for", () => {
    expect(buildMuseArgs({ workspace: CWD, model: "muse-spark-1.2-contributor", reasoningEffort: "high" })).toEqual([
      "--yolo",
      "--workspace",
      CWD,
      "--model",
      "muse-spark-1.2-contributor",
      "--reasoning-effort",
      "high",
    ]);
  });

  it("omits everything that was not asked for", () => {
    expect(buildMuseArgs({ resume: null, workspace: null, model: null, reasoningEffort: null, initialPrompt: null })).toEqual(["--yolo"]);
  });

  // Positional, so anything after it would be swallowed as part of the prompt text.
  it("puts the seed prompt last on a fresh session", () => {
    const args = buildMuseArgs({ workspace: CWD, model: "m", initialPrompt: "/collect run" });
    expect(args[args.length - 1]).toBe("/collect run");
  });

  it("omits an empty seed prompt rather than passing an empty positional", () => {
    expect(buildMuseArgs({ workspace: CWD, initialPrompt: "" })).toEqual(["--yolo", "--workspace", CWD]);
  });

  // `muse resume <id> <prompt>` is not a command line muse accepts, so a seed cannot ride along
  // with a resume — and it must not silently become the resume's argument either.
  it("does not append a seed prompt to a resume", () => {
    expect(buildMuseArgs({ resume: ID, workspace: CWD, initialPrompt: "go" })).toEqual(["--yolo", "--workspace", CWD, "resume", ID]);
  });
});
