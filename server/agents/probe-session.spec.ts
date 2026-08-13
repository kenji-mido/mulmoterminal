// @vitest-environment node
import { describe, it, expect } from "vitest";
import { newProbeSessionId, isProbeSessionId, PROBE_SESSION_PREFIX } from "./probe-session";
import { SESSION_ID_RE } from "../config/env";

// Codex review on #1019: a remembered set of ids stops recognising its own sessions the moment the
// process restarts, while the transcripts claude wrote are still on disk — so #1010 comes back on
// its own. Recognising them by SHAPE is what makes the classification outlive the process.
describe("probe session ids", () => {
  it("is a valid session id, so claude and the registry both accept it", () => {
    for (let i = 0; i < 50; i++) expect(newProbeSessionId()).toMatch(SESSION_ID_RE);
  });

  it("is recognisable without anything being remembered", () => {
    expect(isProbeSessionId(newProbeSessionId())).toBe(true);
    expect(isProbeSessionId(`${PROBE_SESSION_PREFIX}4000-8000-000000000000`)).toBe(true);
  });

  it("does not claim an ordinary session", () => {
    expect(isProbeSessionId("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(false);
    expect(isProbeSessionId("")).toBe(false);
  });

  // Codex review on #1030: the id becomes a file path (`<sessions-dir>/<id>.jsonl`) in the code
  // that DELETES a transcript, so matching only the opening would let a crafted value walk out of
  // the directory — with the guard that reads as protection granting it.
  it("rejects anything carrying a path out of the sessions directory", () => {
    expect(isProbeSessionId(`${PROBE_SESSION_PREFIX}../../../../etc/passwd`)).toBe(false);
    expect(isProbeSessionId(`${PROBE_SESSION_PREFIX}4000-8000-000000000000/../../secret`)).toBe(false);
    expect(isProbeSessionId(`${PROBE_SESSION_PREFIX}..`)).toBe(false);
    expect(isProbeSessionId(`${PROBE_SESSION_PREFIX}4000-8000-00000000000\\..\\win`)).toBe(false);
  });

  it("rejects the prefix with anything else appended, however harmless", () => {
    expect(isProbeSessionId(PROBE_SESSION_PREFIX)).toBe(false);
    expect(isProbeSessionId(`${PROBE_SESSION_PREFIX}4000-8000-000000000000-extra`)).toBe(false);
    expect(isProbeSessionId(`${PROBE_SESSION_PREFIX}4000-8000-00000000000g`)).toBe(false);
    expect(isProbeSessionId(` ${PROBE_SESSION_PREFIX}4000-8000-000000000000`)).toBe(false);
    expect(isProbeSessionId(`${PROBE_SESSION_PREFIX}4000-8000-000000000000\n`)).toBe(false);
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newProbeSessionId()));
    expect(ids.size).toBe(200);
  });
});
