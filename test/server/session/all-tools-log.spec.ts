// @vitest-environment node
// The log that says which sessions carry the whole GUI MCP. It needs a release marker for the
// reason session-tool-groups.ts needs one: a session id outlives the process that earned the
// claim, and a stale yes now stands a cell's group urls down with nothing to replace them.
import { describe, it, expect } from "vitest";

import { parseAllToolsLog, allToolsLogLine, ALL_TOOLS_RELEASE } from "../../../server/session/all-tools-log.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const isValidId = (id: string) => /^[0-9a-f-]{36}$/.test(id);

describe("parseAllToolsLog", () => {
  it("reads a bare id as a claim, so a file written before the marker existed still works", () => {
    expect(parseAllToolsLog(`${A}\n${B}`, isValidId).sort()).toEqual([A, B].sort());
  });

  it("drops a claim that a later release cancels", () => {
    expect(parseAllToolsLog(`${A}\n${A} ${ALL_TOOLS_RELEASE}`, isValidId)).toEqual([]);
  });

  // The ordering is the whole reason this is not a set union: a session released and then given
  // the url again is carrying it.
  it("takes the LAST word for a session", () => {
    expect(parseAllToolsLog(`${A}\n${A} ${ALL_TOOLS_RELEASE}\n${A}`, isValidId)).toEqual([A]);
    expect(parseAllToolsLog(`${A} ${ALL_TOOLS_RELEASE}\n${A}\n${A} ${ALL_TOOLS_RELEASE}`, isValidId)).toEqual([]);
  });

  it("releases one session without touching another", () => {
    expect(parseAllToolsLog(`${A}\n${B}\n${A} ${ALL_TOOLS_RELEASE}`, isValidId)).toEqual([B]);
  });

  it("releases a session that was never claimed, harmlessly", () => {
    expect(parseAllToolsLog(`${A} ${ALL_TOOLS_RELEASE}`, isValidId)).toEqual([]);
  });

  // Dropped rather than guessed at — the same rule the tool-group parser follows, and these end up
  // compared against real session ids.
  it.each([["not-a-uuid"], [`${A} ${ALL_TOOLS_RELEASE} extra`], [`${A} nonsense`], [""], ["   "]])("drops the unusable line %j", (line) => {
    expect(parseAllToolsLog(line, isValidId)).toEqual([]);
  });

  it("tolerates blank lines and surrounding whitespace", () => {
    expect(parseAllToolsLog(`\n  ${A}  \n\n`, isValidId)).toEqual([A]);
  });
});

describe("allToolsLogLine", () => {
  // Leading newline, for the reason session-id-log.ts spells out: an appended entry must start its
  // own line whatever the file ended with, or a cut-off write welds two entries together.
  it("leads with a newline in both directions", () => {
    expect(allToolsLogLine(A, true)).toBe(`\n${A}`);
    expect(allToolsLogLine(A, false)).toBe(`\n${A} ${ALL_TOOLS_RELEASE}`);
  });

  // The round trip is what the two halves have to agree on, and where a format change would show.
  it("round-trips through the parser", () => {
    const file = [allToolsLogLine(A, true), allToolsLogLine(B, true), allToolsLogLine(A, false)].join("");
    expect(parseAllToolsLog(file, isValidId)).toEqual([B]);
  });
});
