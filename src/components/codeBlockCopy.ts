// What "copy the last code block" should do with a fetched turn (#865). Pure, so the states a
// user can land in are pinned by tests rather than only reachable by clicking.
//
// Both non-ok outcomes are NOT errors, and telling them apart is the whole point: "that reply had
// no code" and "there is no completed turn yet" need different sentences. Collapsing them into one
// failure message is what makes a button feel broken.
import { lastFencedBlock } from "../../common/codeBlocks";

export type CopyOutcome = { kind: "ok"; text: string; lang: string | null } | { kind: "no-code" } | { kind: "no-turn" };

export function copyOutcomeFor(turn: { reply: string | null }): CopyOutcome {
  if (!turn.reply) return { kind: "no-turn" };
  const block = lastFencedBlock(turn.reply);
  return block ? { kind: "ok", text: block.body, lang: block.lang } : { kind: "no-code" };
}

/** One short line for the button's transient label. Deliberately says what happened rather than
 *  "failed", because none of these is a fault the user can act on by retrying. */
export function copyOutcomeMessage(outcome: CopyOutcome): string {
  switch (outcome.kind) {
    case "ok":
      return "Copied";
    case "no-code":
      return "No code block in the last reply";
    case "no-turn":
      return "No completed turn yet";
  }
}

/** The Clipboard API exists only in a secure context — over `http://<lan-ip>:PORT`, which is how
 *  the phone and a second machine reach this app, `navigator.clipboard` is undefined. Pasting
 *  into another app is exactly what those users are here for, so the caller shows the text for
 *  manual selection instead of reporting a failure. */
export const clipboardAvailable = (): boolean => typeof navigator !== "undefined" && !!navigator.clipboard?.writeText;
