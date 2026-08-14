// Tell the AGENT when a schema it just wrote would not survive a clone.
//
// The portability check has a route and a button (plans/HANDOFF-collections-projects.md §3.6), and
// both need a person to think of asking. The agent is the one who chose the storage kind, dropped
// the `primaryKey` or put the collection in user scope — and it is holding the file open at the
// moment the answer is cheapest to act on.
//
// WHY `putSchema` AND NOTHING ELSE. It is the only action that changes what the check reads:
// creation is a plain file write the engine never sees (`putSchema` refuses an unknown collection
// and says to create it by writing SKILL.md + schema.json), and the record actions cannot move a
// collection in or out of portability. Hooking a read action would spend a git call on every
// listing to say the same thing repeatedly.
//
// It is ADDITIVE and quiet: a clean collection is not mentioned at all, a refusal or a validation
// error is passed through untouched, and a failure of the check itself changes nothing. The agent
// never has to handle a new failure mode to keep working.
import { isRecord } from "../../common/isRecord.js";
import { checkCollectionSelfContainment } from "../backends/collectionSelfContainment.js";

/** `putSchema`'s success narration, parsed — or null for anything else, INCLUDING its refusals.
 *  Those are prose, and prose is what the agent is meant to read and act on: appending to it
 *  would bury the reason the write did not happen. */
function writtenPayload(narration: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(narration);
  } catch {
    return null;
  }
  return isRecord(parsed) && parsed.written === true ? parsed : null;
}

function slugOf(args: Record<string, unknown>): string | null {
  return typeof args.slug === "string" && args.slug.length > 0 ? args.slug : null;
}

/** Wrap a manageCollection handler so a successful `putSchema` carries the collection's
 *  portability findings back with it.
 *
 *  `rootOf` is a thunk for the same reason the tool's own `workspaceRoot` is: the workspace
 *  handler is built at module scope, before boot binds a root. */
export function withPortabilityNote(handler: (args: Record<string, unknown>) => Promise<string>, rootOf: () => string) {
  return async (args: Record<string, unknown>): Promise<string> => {
    const narration = await handler(args);
    if (args.action !== "putSchema") return narration;
    const slug = slugOf(args);
    if (slug === null) return narration;
    const written = writtenPayload(narration);
    if (!written) return narration;
    try {
      const report = await checkCollectionSelfContainment(slug, { workspaceRoot: rootOf() });
      // Nothing to say about a collection that already travels — silence is the answer there,
      // and a `portability: { findings: [] }` on every write would be noise the agent learns to
      // skip, which is how the one that matters gets skipped too.
      if (!report || report.findings.length === 0) return narration;
      return JSON.stringify({ ...written, portability: { portable: report.portable, findings: report.findings } });
    } catch {
      // The check is an extra, not a gate: the schema IS written, and reporting the write is the
      // handler's actual job. A git that would not run must not turn that into an error.
      return narration;
    }
  };
}
