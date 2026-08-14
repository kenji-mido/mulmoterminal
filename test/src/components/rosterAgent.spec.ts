import { describe, it, expect } from "vitest";
import { rosterAgent } from "../../../src/components/rosterAgent";
import { shellLauncher, type Cell } from "../../../src/components/gridTabs";

const SESSION = "11111111-1111-1111-1111-111111111111";
const cell = (over: Partial<Cell> = {}): Cell => ({ uid: 0, session: SESSION, cwd: "/w", ...over });

describe("rosterAgent", () => {
  // `Cell.agent` is the ABSENT case for Claude, so this is the one row where the old `?? "claude"`
  // was right — and the reason the wrong rows were invisible.
  it("says claude for a session cell that names no agent", () => {
    expect(rosterAgent(cell())).toBe("claude");
  });

  it("keeps the agent a session cell was launched as", () => {
    expect(rosterAgent(cell({ agent: "codex" }))).toBe("codex");
    expect(rosterAgent(cell({ agent: "grok" }))).toBe("grok");
  });

  // The two kinds that run the user's own command line. Neither carries an `agent`, so both used to
  // read as Claude; nothing here looks at what the command is called.
  it("says shell for a launcher cell", () => {
    expect(rosterAgent(cell({ launcher: shellLauncher() }))).toBe("shell");
    expect(rosterAgent(cell({ launcher: { index: 2, label: "codex --yolo" } }))).toBe("shell");
  });

  it("says shell for a run-command cell, from either source", () => {
    expect(rosterAgent(cell({ command: { source: "script", index: 0, label: "test", cwd: "/w" } }))).toBe("shell");
    // A `button` command carries the agent of the SESSION its button belongs to. That is the
    // context it was resolved against, not what the cell runs — the cell runs a shell command.
    const button = { source: "button", buttonId: "b1", label: "build", cwd: "/w", session: SESSION, agent: "codex", model: null } as const;
    expect(rosterAgent(cell({ command: button, agent: "codex" }))).toBe("shell");
  });

  it("says nothing at all for a cell that has launched nothing", () => {
    expect(rosterAgent(cell({ session: null }))).toBeNull();
  });
});
