import { getPlugin } from "../plugins-registry";
import { isRecord } from "../../common/isRecord";

/**
 * Did this `session:<id>` pub/sub payload DRAW something — i.e. will the Canvas panel render a
 * card for it?
 *
 * Every GUI tool result publishes on that channel, including ones with no view of their own
 * (manageCollection, google). Revealing the Canvas for those would be a switch with nothing behind
 * it to explain itself, so the auto-open paths ask this first — and they ask it the same way the
 * panel does before rendering a card, so the two cannot disagree about what "drew something" means.
 *
 * Shared because two callers need the same answer: TerminalGrid (the drawing cell is the enlarged
 * one — open the pane beside it) and GridView (nothing is enlarged — enlarge the drawing cell and
 * open the pane).
 */
export function isDrawnResult(data: unknown): boolean {
  if (!isRecord(data)) return false;
  return typeof data.toolName === "string" && Boolean(getPlugin(data.toolName));
}
