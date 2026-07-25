import { describe, it, expect } from "vitest";
import { normalizedGridJson, parseServerGridState } from "../../../src/components/gridStateServer";
import type { GridState } from "../../../src/components/gridTabs";

const grid = (cells: GridState["cells"]): GridState => ({ cells, expanded: null, page: 0, nextUid: cells.length, sortMode: "manual" });
const S = "11111111-1111-1111-1111-111111111111";

describe("normalizedGridJson", () => {
  it("ignores a transient launch cell (session=null) — the sync key is unchanged by opening '+'", () => {
    const withSession = grid([{ uid: 0, session: S, cwd: "/p" }]);
    const plusLaunchCell = grid([
      { uid: 0, session: S, cwd: "/p" },
      { uid: 1, session: null, cwd: null }, // the half-filled "+" launcher
    ]);
    expect(normalizedGridJson(plusLaunchCell)).toBe(normalizedGridJson(withSession));
  });

  it("changes when the SESSION set changes", () => {
    const one = grid([{ uid: 0, session: S, cwd: "/p" }]);
    const two = grid([
      { uid: 0, session: S, cwd: "/p" },
      { uid: 1, session: "22222222-2222-2222-2222-222222222222", cwd: "/q" },
    ]);
    expect(normalizedGridJson(one)).not.toBe(normalizedGridJson(two));
  });

  it("is idempotent — a parsed server grid re-normalizes to itself", () => {
    const remote = parseServerGridState({ cells: [{ uid: 5, session: S, cwd: "/p" }], expanded: null, page: 0, nextUid: 9, sortMode: "manual" });
    expect(remote).not.toBeNull();
    if (remote) expect(normalizedGridJson(remote)).toBe(JSON.stringify(remote));
  });
});
