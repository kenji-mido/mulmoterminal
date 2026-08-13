// Turning a failed `gh` / `glab` call into the reason a user can act on (#1369).
//
// Server-side only: the client is handed the conclusion, never the stderr. Forge output names
// repositories, hosts and endpoints, and it lands on a chip in someone's terminal — the four
// causes in WorkCommentFailure are all the UI needs to word a sentence.
//
// Classified on the HTTP status the CLIs print rather than on their English, because the two
// spellings do not agree on anything else. Measured, not assumed (see plans/):
//
//   gh api      → `gh: Bad credentials (HTTP 401)`
//   gh issue    → `HTTP 401: Bad credentials (https://api.github.com/graphql)`
//   glab api    → `glab: 401 Unauthorized (HTTP 401)`
//   gh, no auth → `To get started with GitHub CLI, please run:  gh auth login`   ← no status at all
import { GH_MISSING_STDERR } from "./gh.js";
import { GLAB_MISSING_STDERR } from "./glab.js";
import type { WorkCommentFailure } from "../../common/workCommentFailure.js";

// Matches both spellings above — parenthesised and colon-terminated. Fixed width and no nested
// quantifier, so there is nothing here to backtrack over.
const HTTP_STATUS = /\bHTTP (\d{3})\b/;

// The logged-out case, which is the common one and carries NO status: `gh` answers the invitation
// to log in instead of calling the API at all. Checked after the sentinels below, because the
// "not found" message names the same command inside its install hint.
const AUTH_HINT = /\b(?:gh|glab) auth login\b/;

/**
 * Why a forge write failed, from the CLI's own stderr. Unknown is the honest answer for a network
 * blip or a rate limit — both are temporary, and the next milestone tries again.
 */
export function classifyForgeFailure(stderr: string): WorkCommentFailure {
  // Exact, not a substring: this is a string THIS app produced when the spawn failed, so an
  // equality check cannot be fooled by a forge quoting something similar back at us.
  if (stderr === GH_MISSING_STDERR || stderr === GLAB_MISSING_STDERR) return "cli-missing";
  const status = HTTP_STATUS.exec(stderr)?.[1];
  if (status === "401") return "auth";
  // The cause this whole reason-reporting exists for: the login works, and the account still
  // cannot write on that repository.
  if (status === "403") return "permission";
  if (status === undefined && AUTH_HINT.test(stderr)) return "auth";
  return "unknown";
}
