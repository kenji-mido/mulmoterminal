// Passing one turn round a ring of terminals until the group is done (#1456).
//
// This is `runOneExchange` generalised from self → partner → self to N cells × M turns. Everything
// it needs already exists: the excerpt comes from the server rendered exactly as a two-cell
// handoff does, the correlation that decides "is this reply ours" is `answersOurSend`, and the
// submit is the same one the exchange uses.
//
// What is deliberately NOT here: any new capability for the agents. They call nothing, see no
// other cell, and cannot start or join anything — the runner reads their turns and types the next
// one in. That is what makes "an agent starts a conversation on its own" impossible rather than
// merely discouraged, and it is why this feature needs no MCP tool (#1456).
//
// It runs in the browser, like the exchange it generalises: close the tab and the table stops. A
// conversation that continues where nobody is watching is a different feature with a different
// safety argument.
import { waitVerdict } from "./exchangeRules";
import type { HandoffSource, HandoffTarget } from "./useHandoff";
import { endsTheTable, nextSpeaker, roundTablePrompt, type RoundTableOutcome } from "./roundTableRules";
import { formatRoom, roomWindow } from "../../common/roomMessage";
import { fetchRoom, postRoomMessage } from "./useRooms";
import { liveCrossTalkDeps, type TurnFetch, type CrossTalkDeps } from "./useCrossTalk";
import { ANSWER_TIMEOUT_MS, POLL_MS } from "./useCrossTalk";

/** A seat at the table: which slot to type into, and which log to read back. */
export interface TableMember {
  key: string;
  label: string;
  source: HandoffSource;
}

export interface RoundTableRun {
  outcome: RoundTableOutcome;
  /** Turns actually taken, so the caller can say "3 of 6" rather than only why it ended. */
  turnsTaken: number;
}

/** The exchange's dependency surface plus the room (#1456).
 *
 *  This type and the factory below were folded into `CrossTalkDeps` / `liveCrossTalkDeps` while
 *  they were byte-identical, and the note left behind said what would earn the split back: "the
 *  table needs something the exchange genuinely does not — its own socket, its own clock, a fact
 *  only a ring of N cells has." The room is that. A two-cell exchange hands one reply straight to
 *  the other cell and keeps no record; a table posts every turn and reads the whole conversation
 *  back, which is a socket the exchange has no use for.
 *
 *  The room arrives as a DEPENDENCY rather than a direct fetch for the reason the rest of this
 *  does: the loop's ordering is what breaks, and ordering is only testable when nothing in here
 *  talks to a server by itself. */
export interface RoundTableDeps extends CrossTalkDeps {
  /** Append what somebody said. Failure is not fatal — a table whose log is unwritable is still a
   *  conversation, and stopping it would be a worse answer than losing the record. */
  postToRoom: (room: string, from: string, text: string) => Promise<void>;
  /** The conversation so far, already windowed and framed for a reader. */
  readRoom: (room: string) => Promise<string>;
}

/** Poll a member's log until the turn OUR message produced appears. Same rule as the exchange:
 *  correlate on what was sent, never on "something changed", or a member that was already mid-turn
 *  hands back a reply to somebody else's question. */
async function awaitReply(source: HandoffSource, sent: string, deps: RoundTableDeps): Promise<TurnFetch | RoundTableOutcome> {
  const startedAt = deps.now();
  for (;;) {
    await deps.sleep(POLL_MS);
    if (deps.isAborted()) return "stopped";
    const now = await deps.fetchTurn(source, "reply");
    const verdict = waitVerdict(now, sent, deps.now() - startedAt, ANSWER_TIMEOUT_MS);
    if (verdict === "answered") return now;
    if (verdict === "timed-out") return "timed-out";
  }
}

/** Hand `excerpt` to one member and wait for what they say back. Null outcome means it worked. */
async function takeTurn(
  member: TableMember,
  excerpt: string,
  framing: { members: readonly string[]; turn: number; budget: number },
  deps: RoundTableDeps,
): Promise<TurnFetch | RoundTableOutcome> {
  if (deps.isAborted()) return "stopped";
  // Checked immediately before submitting, like the exchange does: a submit addresses a SLOT, and
  // a cell whose session was switched underneath would be handed somebody else's conversation.
  if (!deps.runsSession(member.key, member.source.sessionId)) return "session-changed";
  const sent = roundTablePrompt({ speaker: member.label, ...framing }, excerpt);
  if (!deps.submit(member.key, sent)) return "failed";
  return awaitReply(member.source, sent, deps);
}

/**
 * Run the table. `members[0]` is the cell the user started from: its last completed turn is what
 * opens the conversation, and the turn then goes round the ring.
 *
 * `budget` counts SUBMISSIONS, not laps — a table of three with a budget of six comes round twice.
 * Every one of them is a real agent turn on a real account, so the number is a cost control as
 * much as a runaway guard.
 */
export async function runRoundTable(members: readonly TableMember[], room: string, budget: number, deps: RoundTableDeps): Promise<RoundTableRun> {
  const names = members.map((member) => member.label);
  let turnsTaken = 0;
  try {
    // The seed is the starting cell's own last turn, in the `exchange` shape — it opens the room
    // with both sides, since nobody reading it yet has any context at all.
    const opener = members[0];
    if (!opener) return { outcome: "nothing-to-send", turnsTaken };
    const opening = await deps.fetchTurn(opener.source, "exchange");
    if (!opening.text) return { outcome: "nothing-to-send", turnsTaken };
    await deps.postToRoom(room, opener.label, opening.reply ?? opening.text);

    // What to hand on when the room cannot be read. Room I/O is deliberately non-fatal — a table
    // whose log is unwritable is still a conversation — but that means an empty read is
    // indistinguishable from a failed one, and ending the table on it would let one dropped
    // request kill a live conversation (Codex review on #1456). So the previous speaker's own
    // turn is kept as a fallback: the table degrades to what v1 did, rather than stopping.
    let lastHandoff = opening.text;
    let speaker = 0;
    while (turnsTaken < budget) {
      speaker = nextSpeaker(speaker, members.length);
      // The whole conversation, not just the last thing said. Handing on only the previous reply
      // is what a two-cell exchange does, and with three or more it loses the thread: the reader
      // cannot see what the seat before last argued (#1456).
      const conversation = (await deps.readRoom(room)) || lastHandoff;
      if (!conversation) return { outcome: "nothing-to-send", turnsTaken };
      // `nextSpeaker` is a modulo of a list just proved non-empty, so the fallback is unreachable —
      // it is here because an index expression is not narrowed by that proof.
      const member = members[speaker] ?? opener;
      const said = await takeTurn(member, conversation, { members: names, turn: turnsTaken + 1, budget }, deps);
      if (typeof said === "string") return { outcome: said, turnsTaken };
      turnsTaken++;
      // The RAW reply goes into the room, never the rendered excerpt: the excerpt is the room read
      // back plus our own framing, so storing it would fold the whole conversation into the room
      // again on every turn.
      await deps.postToRoom(room, member.label, said.reply ?? "");
      if (said.text) lastHandoff = said.text;
      // Against the RAW reply for the same reason — and only once the lap is complete. The first
      // live three-cell run ended on turn 1, before the third cell had said anything at all.
      if (endsTheTable(said.reply, turnsTaken, members.length)) return { outcome: "agreed", turnsTaken };
    }
    return { outcome: "budget-spent", turnsTaken };
  } catch {
    return { outcome: "failed", turnsTaken };
  }
}

/** The table's own wiring: the exchange's sockets plus the room. `liveCrossTalkDeps` no longer
 *  covers it — the room is the thing the exchange does not have (see RoundTableDeps). */
export function liveRoundTableDeps(isAborted: () => boolean): RoundTableDeps {
  return {
    ...liveCrossTalkDeps(isAborted),
    postToRoom: postRoomMessage,
    readRoom: async (room) => formatRoom(roomWindow(await fetchRoom(room))),
  };
}

/** A handoff target as a seat at the table — the picker lists the same cells the exchange menu
 *  does, so one rule decides what is readable. */
export const memberFromTarget = (target: HandoffTarget): TableMember => ({ key: target.key, label: target.label, source: target.source });
