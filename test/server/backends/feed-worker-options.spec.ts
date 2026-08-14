// @vitest-environment node
//
// One option, its own spec, because getting it wrong is silent: the agent-ingest seed prompt
// addresses records ROOT-RELATIVELY, so the worker's cwd decides which project it writes into.
// Per-project feed refresh shipped once and was REVERTED for exactly this (#1582) — the runner
// had no root to spawn in, so a project's scheduled refresh filled the workspace's same-named
// collection. Both paths exist; neither side errors.
import { describe, it, expect } from "vitest";
import { feedWorkerSpawnOptions } from "../../../server/backends/feed-worker-options";

describe("feedWorkerSpawnOptions", () => {
  it("runs the worker IN the root the refresh is for", () => {
    expect(feedWorkerSpawnOptions("go", "/srv/mag2")).toEqual({ initialPrompt: "go", cwd: "/srv/mag2" });
  });

  // The host's own workspace: what a single-workspace host passes, and what every refresh was
  // before projects existed. The spawn must be exactly what it always was.
  it("names no cwd when the refresh carries no root", () => {
    expect(feedWorkerSpawnOptions("go")).toEqual({ initialPrompt: "go" });
    expect(Object.hasOwn(feedWorkerSpawnOptions("go"), "cwd")).toBe(false);
  });

  // An empty string is not a directory. Passing it through would spawn in a cwd the spawner then
  // has to interpret, which is the ambiguity `undefined` exists to avoid.
  it("treats an empty root as no root", () => {
    expect(feedWorkerSpawnOptions("go", "")).toEqual({ initialPrompt: "go" });
  });

  it("carries the prompt through untouched", () => {
    const message = "line one\nline two — with punctuation";
    expect(feedWorkerSpawnOptions(message, "/srv/x").initialPrompt).toBe(message);
  });
});
