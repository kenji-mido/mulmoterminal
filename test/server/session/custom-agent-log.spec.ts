import { describe, it, expect } from "vitest";
import { applyCustomAgentSession, customAgentSessionLine, customAgentSessionRecord, type CustomAgentSession } from "../../../server/session/custom-agent-log";
import { isCustomAgentId } from "../../../common/customAgents";

// Which custom agent a session was started on, persisted so it outlives both the pty and the
// server — the transcript does, and a resume deliberately ignores the Agent Picker, so this file
// is the only thing that keeps a resumed conversation on the agent it began on (#1414).

const SESSION = "11111111-2222-4333-8444-555555555555";
const isValidSessionId = (id: string) => /^[0-9a-f-]{36}$/.test(id);

const parse = (line: string) => customAgentSessionRecord(JSON.parse(line) as Record<string, unknown>, isValidSessionId, isCustomAgentId);

describe("customAgentSessionLine / customAgentSessionRecord (#1414)", () => {
  it("round-trips a record through one line", () => {
    const record: CustomAgentSession = { sessionId: SESSION, agentId: "nemotron" };
    const line = customAgentSessionLine(record);
    expect(line.endsWith("\n")).toBe(true); // one record per line — the file is appended to, never rewritten
    expect(parse(line)).toEqual(record);
  });

  it("drops a line whose session id is not one", () => {
    expect(customAgentSessionRecord({ sessionId: "../../etc/passwd", agentId: "nemotron" }, isValidSessionId, isCustomAgentId)).toBeNull();
    expect(customAgentSessionRecord({ agentId: "nemotron" }, isValidSessionId, isCustomAgentId)).toBeNull();
  });

  // The id is looked up in the live config and never run, but a name the picker could not have
  // produced has no business being carried either — the same rule that guards the config.
  it("drops a line whose agent id the config would not accept", () => {
    expect(customAgentSessionRecord({ sessionId: SESSION, agentId: "Nemotron" }, isValidSessionId, isCustomAgentId)).toBeNull();
    expect(customAgentSessionRecord({ sessionId: SESSION, agentId: "claude" }, isValidSessionId, isCustomAgentId)).toBeNull();
    expect(customAgentSessionRecord({ sessionId: SESSION }, isValidSessionId, isCustomAgentId)).toBeNull();
  });

  // The log only grows: a session relaunched on another agent appends a second line, and reading
  // in file order has to leave the LAST one standing — that is the one describing how it runs now.
  it("lets a later line win for the same session", () => {
    const sessions = new Map<string, string>();
    applyCustomAgentSession(sessions, { sessionId: SESSION, agentId: "nemotron" });
    applyCustomAgentSession(sessions, { sessionId: SESSION, agentId: "kimi_k3" });
    expect(sessions.get(SESSION)).toBe("kimi_k3");
  });
});
