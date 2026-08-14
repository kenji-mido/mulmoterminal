// Which project a phone's command operates on.
//
// PREPARATION, not a feature: no client sends the parameter yet, and every command below
// resolves the host's own workspace exactly as it did before this file existed. It is written now
// because the parts that are hard to change later are the ones being written today — the day a
// phone gains a project picker, the only new thing should be the picker
// (../mulmoclaude/plans/feat-collection-multi-root-2.md §8, and the contract on core's
// `COMMAND_SCOPE_PARAM`).
//
// Three rules the handlers inherit by using this:
//
// 1. **AN OPAQUE ID, NEVER A PATH.** The phone is a genuinely remote client, so an absolute root
//    in a command, an artifact or a token publishes the user's home directory over the wire. The
//    id is resolved HERE, against the list the server owns (`rootForProjectId`), and a path never
//    travels in either direction.
// 2. **The artifact stays host-built.** A remote view's srcdoc, its inlined thumbnails and its
//    token are assembled on the host, so the phone never resolves a path itself. That is what
//    makes (1) hold without trusting the client — see remoteView.ts.
// 3. **Handlers resolve a scope; they do not hard-code one.** Hence this call replacing an inline
//    `workspaceScope()` at each site, even though today the two are the same value.
import { readCommandScope } from "@mulmoclaude/core/remote-host";
import type { JsonObject } from "@mulmoclaude/core/remote-host";
import { rootForProjectId, workspaceScope, type ProjectScope } from "../../infra/project-root.js";

/** The scope a command runs in: the project it named, or the host's workspace when it named none.
 *
 *  A NAMED-BUT-UNKNOWN project THROWS, and that is a deliberate divergence from the wording on
 *  core's `readCommandScope` ("must fall back to the default"). Falling back would serve the
 *  workspace's `tasks` to a phone that asked for a project's `tasks` — same command, same shape,
 *  different records, nothing anywhere saying so. That silent wrong-root answer is the failure
 *  this whole feature removed on the HTTP side (`resolveProjectRoot` answers 400), and the phone
 *  must not reintroduce it. An absent scope still defaults, which is what core's rule is really
 *  about and what keeps today's behaviour identical.
 *
 *  `fallback` is the host root the caller was constructed with, for the handlers that receive one
 *  by injection rather than reading it globally. */
export function scopeFromCommand(params: JsonObject, fallback?: string): ProjectScope {
  const requested = readCommandScope(params);
  if (requested === undefined) return fallback === undefined ? workspaceScope() : { workspaceRoot: fallback };
  const root = rootForProjectId(requested);
  // The id is opaque and client-supplied, so it is not echoed into the message: a value that
  // reaches a log or a phone's error toast is one more thing travelling that need not.
  if (root === null) throw new Error("unknown project");
  return { workspaceRoot: root };
}
