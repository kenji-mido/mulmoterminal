// @vitest-environment node
// What Settings is told about the sessions that outlived the server (#1478).
//
// The rule this pins is the ORDER and what each row reports, because the list has one job: letting
// someone decide what to end. A row that cannot say where it runs, how long it has been sitting, or
// whether ending it loses the conversation is not a decision anyone can make.
import { describe, it, expect } from "vitest";

import { buildSurvivingSessions, type SurvivingInput } from "../../../server/session/surviving-sessions.js";
import { byClearability } from "../../../common/survivingSessions.js";

const HOUR = 3600;
const NOW = 1_000_000;

const input = (over: Partial<SurvivingInput> = {}): SurvivingInput => ({
  tmuxIds: [],
  activity: new Map(),
  nowSeconds: NOW,
  attached: () => false,
  resumable: () => false,
  cwdOf: () => null,
  agentOf: () => null,
  reapable: () => false,
  ...over,
});

describe("buildSurvivingSessions", () => {
  it("has nothing to show when tmux has no sessions", () => {
    expect(buildSurvivingSessions(input())).toEqual([]);
  });

  it("reports where a session runs, what it is, and how long it has been sitting", () => {
    const rows = buildSurvivingSessions(
      input({
        tmuxIds: ["s-1"],
        activity: new Map([["s-1", NOW - 2 * HOUR]]),
        cwdOf: () => "/repo",
        agentOf: () => "codex",
        resumable: () => true,
      }),
    );
    expect(rows).toEqual([{ key: "s-1", cwd: "/repo", agent: "codex", idleSeconds: 2 * HOUR, attached: false, resumable: true, reapable: false }]);
  });

  // A shell left behind by a restart: no agent wrote a conversation for it, and nothing on disk can
  // bring it back. Both facts are shown rather than blanked, because this list is the only place it
  // appears at all.
  it("says so when nothing knows what a session is, or can resume it", () => {
    const [row] = buildSurvivingSessions(input({ tmuxIds: ["shell-1"] }));
    expect(row).toMatchObject({ agent: null, resumable: false, cwd: null });
  });

  it("leaves the age unknown rather than inventing one when tmux could not say", () => {
    const [row] = buildSurvivingSessions(input({ tmuxIds: ["s-1"], activity: null }));
    expect(row?.idleSeconds).toBeNull();
  });

  // A clock that moved backwards between tmux's answer and ours would otherwise report a session
  // idle for negative time, which reads as "in the future" wherever it is formatted.
  it("never reports a negative age", () => {
    const [row] = buildSurvivingSessions(input({ tmuxIds: ["s-1"], activity: new Map([["s-1", NOW + 30]]) }));
    expect(row?.idleSeconds).toBe(0);
  });

  // The row says whether the server itself will end it, from the sweep's own rule — so the list
  // shows what is about to happen rather than leaving it to be noticed after a restart (#1467).
  it("marks the rows the boot sweep will end", () => {
    const rows = buildSurvivingSessions(input({ tmuxIds: ["doomed", "safe"], reapable: (key) => key === "doomed" }));
    expect(rows.filter((r) => r.reapable).map((r) => r.key)).toEqual(["doomed"]);
  });

  // The list exists to be cleared, so what CAN be cleared comes first, oldest at the top; a row
  // held by a terminal cannot be stopped from here at all and sinks to the bottom.
  it("puts the stalest unattached session first and the held ones last", () => {
    const rows = buildSurvivingSessions(
      input({
        tmuxIds: ["fresh", "held", "stale"],
        activity: new Map([
          ["fresh", NOW - HOUR],
          ["held", NOW - 99 * HOUR],
          ["stale", NOW - 10 * HOUR],
        ]),
        attached: (key) => key === "held",
      }),
    );
    expect(rows.map((r) => r.key)).toEqual(["stale", "fresh", "held"]);
  });

  // Sorting an unknown age as "oldest" would float exactly the rows nobody can judge to the top.
  it("sorts an unknown age below a known one", () => {
    const rows = buildSurvivingSessions(input({ tmuxIds: ["unknown", "known"], activity: new Map([["known", NOW - HOUR]]) }));
    expect(rows.map((r) => r.key)).toEqual(["known", "unknown"]);
  });
});

describe("byClearability", () => {
  const row = (over: Partial<Parameters<typeof byClearability>[0]>) => ({
    key: "k",
    cwd: null,
    agent: null,
    idleSeconds: 0,
    attached: false,
    resumable: false,
    reapable: false,
    ...over,
  });

  it("ranks an unattached row above an attached one however old either is", () => {
    expect(byClearability(row({ attached: false, idleSeconds: 0 }), row({ attached: true, idleSeconds: 9999 }))).toBeLessThan(0);
  });
});
