import { describe, it, expect } from "vitest";
import {
  DEFAULT_TURN_BUDGET,
  MAX_MEMBERS,
  STOP_MARKER,
  TURN_BUDGETS,
  canRunTable,
  framingLines,
  nextSpeaker,
  roundTableMessage,
  roundTablePrompt,
  wantsToStop,
  everyoneHasSpoken,
  endsTheTable,
  roomForTable,
} from "../../../src/composables/roundTableRules";
import { answersOurSend } from "../../../src/composables/exchangeRules";
import { isRoomId } from "../../../common/roomMessage";

const framing = { speaker: "#1 · claude", members: ["#1 · claude", "#2 · codex", "#3 · claude"], turn: 2, budget: 6 };

describe("wantsToStop", () => {
  it("ends the table on the marker alone on its line", () => {
    expect(wantsToStop(`We agree.\n${STOP_MARKER}`)).toBe(true);
    expect(wantsToStop(`  ${STOP_MARKER}  `)).toBe(true);
  });

  // The marker is named in the framing every speaker receives, so an agent that discusses when to
  // finish would otherwise finish the table by talking about it.
  it("does not end it when the marker is only mentioned", () => {
    expect(wantsToStop(`I will write ${STOP_MARKER} once we agree, but we do not yet.`)).toBe(false);
    expect(wantsToStop(`Nearly done — ${STOP_MARKER}?`)).toBe(false);
  });

  it("reads a missing reply as not finished", () => {
    expect(wantsToStop(null)).toBe(false);
    expect(wantsToStop("")).toBe(false);
  });
});

// Found by running a real three-cell table: the first speaker answered, reasonably decided the
// group had said what it needed to, and wrote the marker on turn 1 — so the third cell never spoke
// at all. A table that ends before it goes round once is not a round table.
describe("everyoneHasSpoken / endsTheTable", () => {
  it("counts the opener as having spoken — its turn is the seed", () => {
    expect(everyoneHasSpoken(1, 2)).toBe(true); // two seats: the other one has now answered
    expect(everyoneHasSpoken(1, 3)).toBe(false); // three seats: the third has not
    expect(everyoneHasSpoken(2, 3)).toBe(true);
  });

  it("ignores the marker until the lap is complete", () => {
    const done = `Agreed.\n${STOP_MARKER}`;
    expect(endsTheTable(done, 1, 3)).toBe(false); // the third seat has not spoken
    expect(endsTheTable(done, 2, 3)).toBe(true);
  });

  it("still ends a two-cell table on the first reply, where the lap IS one turn", () => {
    expect(endsTheTable(`${STOP_MARKER}`, 1, 2)).toBe(true);
  });

  it("never ends on a reply that did not ask to", () => {
    expect(endsTheTable("still thinking", 5, 3)).toBe(false);
  });
});

describe("nextSpeaker", () => {
  it("goes round the ring and wraps", () => {
    expect(nextSpeaker(0, 3)).toBe(1);
    expect(nextSpeaker(1, 3)).toBe(2);
    expect(nextSpeaker(2, 3)).toBe(0);
  });

  it("keeps a two-cell table alternating, like the exchange it generalises", () => {
    expect(nextSpeaker(0, 2)).toBe(1);
    expect(nextSpeaker(1, 2)).toBe(0);
  });

  it("answers 0 for an empty table rather than dividing by zero", () => {
    expect(nextSpeaker(0, 0)).toBe(0);
  });
});

describe("framingLines", () => {
  it("tells the speaker who it is, whose turn it is, and who else is listening", () => {
    const lines = framingLines(framing);
    expect(lines).toContain("turn 2 of 6");
    expect(lines).toContain("you are #1 · claude");
    expect(lines).toContain("#2 · codex, #3 · claude");
    expect(lines).not.toContain("Also at the table: #1 · claude"); // never lists the speaker as an "other"
  });

  it("names the marker once the lap is complete, so a speaker knows how to end the table", () => {
    expect(framingLines({ ...framing, turn: 3 })).toContain(STOP_MARKER);
  });

  // While seats are still to speak, offering the marker is what produced the turn-1 ending in the
  // first live three-cell run. It is withheld and the reason is stated instead.
  it("withholds the marker while somebody has yet to speak", () => {
    const early = framingLines({ ...framing, turn: 1 });
    expect(early).not.toContain(STOP_MARKER);
    expect(early).toContain("Everyone speaks once");
  });

  // The two halves must agree turn for turn: whoever MAY end the table has to be told how, or the
  // instruction arrives a turn after the permission. Written as separate conditions it was off by
  // one in both directions (Codex review on #1456).
  it("shows the marker on exactly the first turn that may end the table", () => {
    const three = ["#1", "#2", "#3"];
    // Three seats: turn 2 completes the lap, so turn 2 is when the marker appears.
    expect(endsTheTable(STOP_MARKER, 1, three.length)).toBe(false);
    expect(framingLines({ speaker: "#2", members: three, turn: 1, budget: 6 })).not.toContain(STOP_MARKER);
    expect(endsTheTable(STOP_MARKER, 2, three.length)).toBe(true);
    expect(framingLines({ speaker: "#3", members: three, turn: 2, budget: 6 })).toContain(STOP_MARKER);
  });

  it("shows it on turn 1 of a two-seat table, which may end there", () => {
    const two = ["#1", "#2"];
    expect(endsTheTable(STOP_MARKER, 1, two.length)).toBe(true);
    expect(framingLines({ speaker: "#2", members: two, turn: 1, budget: 4 })).toContain(STOP_MARKER);
  });
});

// THE trap this feature had to avoid, pinned. `answersOurSend` decides "is this reply ours" from
// the LAST 160 characters of what was submitted, precisely because the opening lines are identical
// on every handoff. Put the framing at the END and every round's tail becomes the same string — so
// a turn finished in the PREVIOUS round matches the message we have only just sent, and the runner
// relays an answer to a question nobody asked.
describe("roundTablePrompt — the framing must not reach the tail", () => {
  const excerptA = "--- their reply ---\n\nThe cache key should include the locale.";
  const excerptB = "--- their reply ---\n\nAgreed, and the currency too.";

  it("keeps the excerpt last, so consecutive rounds do not correlate with each other", () => {
    const round1 = roundTablePrompt({ ...framing, turn: 1 }, excerptA);
    const round2 = roundTablePrompt({ ...framing, turn: 2 }, excerptB);
    // Round 2's message must NOT look like the answer to round 1's, and vice versa.
    expect(answersOurSend(round1, round2)).toBe(false);
    expect(answersOurSend(round2, round1)).toBe(false);
  });

  it("still correlates a prompt with the message that produced it", () => {
    const sent = roundTablePrompt(framing, excerptA);
    expect(answersOurSend(sent, sent)).toBe(true);
  });

  // The regression guard in the most direct form: were the framing appended instead, two rounds
  // whose excerpts differ would end with the same text and match each other.
  it("would have correlated had the framing been appended", () => {
    const appended = (excerpt: string) => `${excerpt}\n\n${framingLines(framing)}`;
    expect(answersOurSend(appended(excerptA), appended(excerptB))).toBe(true);
  });
});

describe("budgets and table size", () => {
  it("offers only small budgets — every turn is a real agent turn on a real account", () => {
    expect(TURN_BUDGETS).toContain(DEFAULT_TURN_BUDGET);
    expect(Math.max(...TURN_BUDGETS)).toBeLessThanOrEqual(20);
  });

  it("needs at least two seats and caps the ring", () => {
    expect(canRunTable(1)).toBe(false); // one cell handing a turn to itself answers nothing
    expect(canRunTable(2)).toBe(true);
    expect(canRunTable(MAX_MEMBERS)).toBe(true);
    expect(canRunTable(MAX_MEMBERS + 1)).toBe(false);
  });
});

describe("roundTableMessage", () => {
  // Unlike a single exchange — where the answer arriving IS the feedback — a table always reports:
  // several cells moved, and why it ended is the one thing none of them shows.
  it("says something for every outcome, including the successful ones", () => {
    expect(roundTableMessage("agreed")).toBeTruthy();
    expect(roundTableMessage("budget-spent")).toBeTruthy();
    expect(roundTableMessage("timed-out")).toBeTruthy();
  });
});

describe("roomForTable", () => {
  const mint = () => "minted-room";

  // Empty is what the box holds by default, and it has to keep meaning what every table did before
  // the box existed.
  it("mints a new room when nothing was typed", () => {
    expect(roomForTable("", mint)).toBe("minted-room");
    expect(roomForTable("   ", mint)).toBe("minted-room");
  });

  // Reuse and naming are the same control: the answer to "which room" is a name, and whether it
  // exists yet is not the user's problem.
  it("takes the name as given, so an existing conversation continues", () => {
    expect(roomForTable("standup", mint)).toBe("standup");
    expect(roomForTable("  Design-Review  ", mint)).toBe("design-review");
  });

  // Never a silent fallback: a table that ran somewhere the user did not name is a conversation
  // they will look for under the name they typed.
  it("refuses a name that cannot be a room id", () => {
    expect(roomForTable("design review", mint)).toBeNull();
    expect(roomForTable("../escape", mint)).toBeNull();
    expect(roomForTable("-leading", mint)).toBeNull();
  });

  it("only ever answers something the room API will accept", () => {
    ["standup", "", "  ", "TABLE-1", "a".repeat(64)].forEach((typed) => {
      const room = roomForTable(typed, mint);
      if (room !== null) expect(isRoomId(room)).toBe(true);
    });
  });
});
