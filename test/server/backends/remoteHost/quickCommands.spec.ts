// @vitest-environment node
import { describe, it, expect } from "vitest";
import { quickCommandsForAgent } from "../../../../server/backends/remoteHost/quickCommands.js";
import type { QuickCommand } from "../../../../common/quickCommands.js";

const PR: QuickCommand = { label: "PR", text: "PR作って", agents: ["claude"] };
const MERGE: QuickCommand = { label: "merge", text: "mergeして" };
const STATUS: QuickCommand = { label: "status", text: "git status", agents: ["shell"] };
const BOTH: QuickCommand = { label: "test", text: "テスト通して", agents: ["claude", "codex"] };

describe("quickCommandsForAgent", () => {
  it("offers an unscoped command to every kind", () => {
    for (const agent of ["claude", "codex", "shell"] as const) {
      expect(quickCommandsForAgent([MERGE], agent)).toEqual([{ label: "merge", text: "mergeして" }]);
    }
  });

  it("offers a scoped command only to the kinds it names", () => {
    expect(quickCommandsForAgent([PR], "claude")).toHaveLength(1);
    expect(quickCommandsForAgent([PR], "shell")).toEqual([]);
    expect(quickCommandsForAgent([PR], "codex")).toEqual([]);
  });

  it("matches any of several kinds", () => {
    expect(quickCommandsForAgent([BOTH], "claude")).toHaveLength(1);
    expect(quickCommandsForAgent([BOTH], "codex")).toHaveLength(1);
    expect(quickCommandsForAgent([BOTH], "shell")).toEqual([]);
  });

  // A session that outlived a restart exists only in tmux, and nothing recorded what launched
  // it. Guessing would mean offering "git status" to what turns out to be Claude.
  it("withholds a scoped command from a session whose kind is unknown, but keeps unscoped ones", () => {
    expect(quickCommandsForAgent([PR, MERGE, STATUS], null)).toEqual([{ label: "merge", text: "mergeして" }]);
  });

  // `agents` is how the HOST decides; the phone renders whatever it is handed.
  it("does not send the scoping to the phone", () => {
    expect(quickCommandsForAgent([PR], "claude")).toEqual([{ label: "PR", text: "PR作って" }]);
    expect(quickCommandsForAgent([PR], "claude")[0]).not.toHaveProperty("agents");
  });

  it("keeps the configured order", () => {
    expect(quickCommandsForAgent([MERGE, PR, BOTH], "claude").map((c) => c.label)).toEqual(["merge", "PR", "test"]);
  });

  it("returns nothing for an empty list", () => {
    expect(quickCommandsForAgent([], "claude")).toEqual([]);
    expect(quickCommandsForAgent([], null)).toEqual([]);
  });

  // sanitizeQuickCommands drops an empty `agents`, but a hand-edited config.json reaches this
  // function directly — and "scoped to nothing" would silently hide the command everywhere.
  it("treats an empty agents list as unscoped", () => {
    expect(quickCommandsForAgent([{ label: "x", text: "y", agents: [] }], "shell")).toHaveLength(1);
    expect(quickCommandsForAgent([{ label: "x", text: "y", agents: [] }], null)).toHaveLength(1);
  });
});
