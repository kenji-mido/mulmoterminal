// Ordered writes, and what a half-finished one leaves behind.
//
// The ORDER is the design (D10), and it is different for each operation because the thing being
// protected is the same in all three: `apps/{aid}.public` is what the rules read to authorize
// anonymous access, so it goes LAST when opening and FIRST when closing. A run that stops
// part-way then leaves the app private, which is the direction to fail in.
//
// `FirestoreDocs` has no batch — it is a document seam, deliberately — so the order is kept by
// running the steps in sequence and reporting exactly where it stopped. A summary written for one
// failure point is wrong at the others, so the report ENUMERATES what landed.
import type { SharedAppFailure } from "./context.js";

export interface WriteStep {
  /** Named as the operator would name it, because it is printed both as the failure and as part
   *  of the list of what is live. */
  what: string;
  run: () => Promise<void>;
}

/** Run the steps in order. Returns null when every one landed, a failure otherwise. */
export async function runWrites(steps: readonly WriteStep[], what: string): Promise<SharedAppFailure | null> {
  const landed: string[] = [];
  for (const [index, step] of steps.entries()) {
    try {
      await step.run();
      landed.push(step.what);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        // The whole reason the flag exists: this is the one failure where documents ARE live.
        partial: index > 0,
        problems: [
          `${what} failed while writing ${step.what}: ${reason}`,
          // The failed step belongs to "not written" — it is the first thing that did not land.
          ...partialState(landed, [step.what, ...steps.slice(index + 1).map((rest) => rest.what)], what),
        ],
      };
    }
  }
  return null;
}

/** What is live and what is not, listed rather than summarised.
 *
 *  Two facts, and both matter for the repair: a document this run wrote is live NOW, and a
 *  document it did not write still holds what the LAST run left — which is not the same as being
 *  absent, and not the same as matching the declaration that was just half-applied. */
function partialState(landed: readonly string[], notWritten: readonly string[], what: string): string[] {
  const repair = `Running ${what} again is the repair: the write is idempotent, and it re-does every step, including the ones that did land.`;
  if (landed.length === 0) return [`Nothing was written. ${repair}`];
  return [
    `Written by this ${what}, and live now: ${landed.join("; ")}.`,
    `NOT written: ${notWritten.join("; ")} — ${notWritten.length === 1 ? "it still holds" : "they still hold"} whatever the previous ${what} left.`,
    repair,
  ];
}
