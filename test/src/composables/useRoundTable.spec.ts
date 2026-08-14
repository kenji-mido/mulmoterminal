import { describe, it, expect } from "vitest";
import { runRoundTable, type RoundTableDeps, type TableMember } from "../../../src/composables/useRoundTable";
import type { TurnFetch } from "../../../src/composables/useCrossTalk";
import type { HandoffSource } from "../../../src/composables/useHandoff";
import { STOP_MARKER, newRoomId } from "../../../src/composables/roundTableRules";
import { isRoomId } from "../../../common/roomMessage";

const src = (id: string): HandoffSource => ({ sessionId: id, cwd: "/w", agent: "claude" });
const seat = (n: number): TableMember => ({ key: `cell-${n}`, label: `#${n}`, source: src(String.fromCharCode(64 + n)) });
const TABLE = [seat(1), seat(2), seat(3)]; // A, B, C

interface HarnessOptions {
  /** A reply that ends the table, keyed by how many turns have been taken when it is produced. */
  stopAfter?: number;
  /** Never record a reply, so the table waits and times out. */
  silent?: boolean;
  /** The socket refuses the submit — a cell that went away between the check and the send. */
  submitFails?: boolean;
}

// Three fake terminals round a ring. A real agent records what it was SENT as its prompt, and the
// runner correlates on exactly that — so the fake has to do the same or nothing ever matches.
function harness(options: HarnessOptions = {}) {
  const turns: Record<string, TurnFetch> = {
    A: { prompt: "the user asked", reply: "A's opening position", text: "OPENING-FROM-A" },
    B: { prompt: null, reply: null, text: "" },
    C: { prompt: null, reply: null, text: "" },
  };
  const submitted: Array<{ key: string; text: string }> = [];
  let clock = 0;
  let aborted = false;
  let sessionsIntact = true;
  let taken = 0;

  const room: { from: string; text: string }[] = [];
  const deps: RoundTableDeps = {
    postToRoom: async (_room, from, text) => {
      room.push({ from, text });
    },
    // What the real deps do: window the room and frame it. Kept simple here — the framing itself
    // is `common/roomMessage`'s job and is tested there.
    readRoom: async () => room.map((m) => `--- ${m.from} ---\n\n${m.text}`).join("\n\n"),
    fetchTurn: async (source) => ({ ...(turns[source.sessionId] ?? { prompt: null, reply: null, text: "" }) }),
    submit: (key, text) => {
      if (options.submitFails) return false;
      submitted.push({ key, text });
      if (options.silent) return true;
      taken += 1;
      const id = key.replace("cell-", "");
      const who = String.fromCharCode(64 + Number(id));
      const done = options.stopAfter === taken;
      turns[who] = { prompt: text, reply: done ? `We are aligned.\n${STOP_MARKER}` : `${who} says ${taken}`, text: `EXCERPT-${who}-${taken}` };
      return true;
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    isAborted: () => aborted,
    runsSession: () => sessionsIntact,
  };
  return { deps, submitted, room, abort: () => (aborted = true), switchSession: () => (sessionsIntact = false) };
}

describe("runRoundTable", () => {
  // The point of the whole feature: a turn goes round three cells without a human between them.
  it("passes the turn round the ring, starting one seat along from the opener", async () => {
    const h = harness();
    const { outcome, turnsTaken } = await runRoundTable(TABLE, "table-1", 6, h.deps);
    expect(outcome).toBe("budget-spent");
    expect(turnsTaken).toBe(6);
    // Never the opener first — its turn is the seed, so it speaks again only after a full lap.
    expect(h.submitted.map((s) => s.key)).toEqual(["cell-2", "cell-3", "cell-1", "cell-2", "cell-3", "cell-1"]);
  });

  // THE reason the room exists (#1456). Handing on only the previous reply is what a two-cell
  // exchange does; with three or more it loses the thread — the third speaker could not see what
  // the first argued, only what the second said about it.
  it("hands each speaker the WHOLE conversation, not just the last thing said", async () => {
    const h = harness();
    await runRoundTable(TABLE, "table-1", 3, h.deps);

    // Turn 1 sees the opener alone — there is nothing else yet.
    expect(h.submitted[0]?.text).toContain("A's opening position");
    // Turn 2 sees the opener AND what turn 1 said.
    expect(h.submitted[1]?.text).toContain("A's opening position");
    expect(h.submitted[1]?.text).toContain("B says 1");
    // Turn 3 sees all of it.
    expect(h.submitted[2]?.text).toContain("A's opening position");
    expect(h.submitted[2]?.text).toContain("B says 1");
    expect(h.submitted[2]?.text).toContain("C says 2");
  });

  it("records every turn in the room, opener first, attributed to its speaker", async () => {
    const h = harness();
    await runRoundTable(TABLE, "table-1", 2, h.deps);
    expect(h.room.map((m) => m.from)).toEqual(["#1", "#2", "#3"]);
    expect(h.room[0]?.text).toBe("A's opening position");
    // The RAW reply, never the rendered excerpt — that excerpt is the room read back, so storing
    // it would fold the whole conversation into the room again on every turn.
    expect(h.room[1]?.text).toBe("B says 1");
    expect(h.room[1]?.text).not.toContain("Round table ·");
  });

  it("tells each speaker whose turn it is and who else is at the table", async () => {
    const h = harness();
    await runRoundTable(TABLE, "table-1", 1, h.deps);
    const sent = h.submitted[0]?.text ?? "";
    expect(sent).toContain("you are #2");
    expect(sent).toContain("#1, #3");
    expect(sent).toContain("turn 1 of 1");
  });

  // A table of two is the existing exchange, reached through the same loop.
  it("alternates a two-cell table", async () => {
    const h = harness();
    const { outcome } = await runRoundTable([seat(1), seat(2)], "table-1", 4, h.deps);
    expect(outcome).toBe("budget-spent");
    expect(h.submitted.map((s) => s.key)).toEqual(["cell-2", "cell-1", "cell-2", "cell-1"]);
  });

  it("ends as soon as a speaker declares the group done", async () => {
    const h = harness({ stopAfter: 2 });
    const { outcome, turnsTaken } = await runRoundTable(TABLE, "table-1", 10, h.deps);
    expect(outcome).toBe("agreed");
    expect(turnsTaken).toBe(2);
    expect(h.submitted).toHaveLength(2); // it does not hand the turn on after the marker
  });

  it("stops at the budget even when nobody says they are done", async () => {
    const h = harness();
    const { outcome, turnsTaken } = await runRoundTable(TABLE, "table-1", 2, h.deps);
    expect(outcome).toBe("budget-spent");
    expect(turnsTaken).toBe(2);
  });

  it("sends nothing when the opening cell has no completed turn", async () => {
    const h = harness();
    const { outcome } = await runRoundTable([{ ...seat(9), source: src("Z") }, seat(2)], "table-1", 4, h.deps);
    expect(outcome).toBe("nothing-to-send");
    expect(h.submitted).toHaveLength(0);
  });

  it("stops when the user stops it", async () => {
    const h = harness();
    h.abort();
    const { outcome } = await runRoundTable(TABLE, "table-1", 4, h.deps);
    expect(outcome).toBe("stopped");
    expect(h.submitted).toHaveLength(0);
  });

  // A submit addresses a SLOT. A cell whose session was switched underneath would be handed a
  // conversation it was never part of.
  it("stops rather than typing into a cell that switched session", async () => {
    const h = harness();
    h.switchSession();
    const { outcome } = await runRoundTable(TABLE, "table-1", 4, h.deps);
    expect(outcome).toBe("session-changed");
    expect(h.submitted).toHaveLength(0);
  });

  it("gives up on a member that never answers", async () => {
    const h = harness({ silent: true });
    const { outcome } = await runRoundTable(TABLE, "table-1", 4, h.deps);
    expect(outcome).toBe("timed-out");
    expect(h.submitted).toHaveLength(1); // it waited on the first member rather than moving on
  });

  // Room I/O is deliberately non-fatal, which makes an empty read indistinguishable from a failed
  // one — so ending the table on it would let one dropped request kill a live conversation.
  // (Codex review on #1456.)
  it("carries on with the previous turn when the room cannot be read", async () => {
    const h = harness();
    let reads = 0;
    const deps: RoundTableDeps = {
      ...h.deps,
      readRoom: async () => {
        reads += 1;
        return reads === 2 ? "" : "the conversation so far"; // one transient failure mid-table
      },
    };
    const { outcome, turnsTaken } = await runRoundTable(TABLE, "table-1", 3, deps);
    expect(outcome).toBe("budget-spent"); // NOT nothing-to-send
    expect(turnsTaken).toBe(3);
  });

  it("stops only when there is nothing to hand on at all", async () => {
    const h = harness();
    const deps: RoundTableDeps = { ...h.deps, fetchTurn: async () => ({ prompt: null, reply: null, text: "" }), readRoom: async () => "" };
    expect((await runRoundTable(TABLE, "table-1", 3, deps)).outcome).toBe("nothing-to-send");
  });

  it("reports a failure to reach a terminal instead of throwing", async () => {
    const h = harness({ submitFails: true });
    expect(await runRoundTable(TABLE, "table-1", 4, h.deps)).toEqual({ outcome: "failed", turnsTaken: 0 });
    expect(h.submitted).toHaveLength(0);
  });
});

// The timestamp alone is second-granular, so two tables started inside one second would share a
// room — mixing two independent conversations into one log that every member of both reads back.
// (Codex review on #1456.)
describe("newRoomId", () => {
  it("keeps two tables started in the same second apart", () => {
    const at = Date.UTC(2026, 7, 6, 4, 12, 33);
    const a = newRoomId(at, () => 0.1);
    const b = newRoomId(at, () => 0.9);
    expect(a).not.toBe(b);
  });

  it("stays a usable room id — it becomes a filename", () => {
    expect(isRoomId(newRoomId(Date.UTC(2026, 7, 6, 4, 12, 33)))).toBe(true);
    expect(isRoomId(newRoomId())).toBe(true);
  });

  it("is still readable and sortable by when it started", () => {
    const earlier = newRoomId(Date.UTC(2026, 7, 6, 4, 12, 33), () => 0.5);
    const later = newRoomId(Date.UTC(2026, 7, 6, 4, 12, 34), () => 0.5);
    expect(earlier < later).toBe(true);
    expect(earlier).toContain("2026-08-06");
  });
});
