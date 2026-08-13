// Why MulmoTerminal could not write its work comment (#1369). Shared, because the server decides
// it from `gh`'s exit and the UI turns it into a sentence — a second copy of the list on the client
// would drift into wording a server can never send.
//
// Not commenting stays a normal outcome: the work carries on either way. What this adds is the
// REASON, which used to exist nowhere — a read-only `gh` login made the feature do nothing at all,
// with the same silence as having it switched off.

/** `permission` is the one this exists for: logged in, but not allowed to write on that repo. */
export type WorkCommentFailure = "cli-missing" | "auth" | "permission" | "unknown";

const FAILURES: readonly WorkCommentFailure[] = ["cli-missing", "auth", "permission", "unknown"];

// The value arrives over the wire, so a build skew (an older server naming a cause this one has
// never heard of) has to read as "no cause" rather than reach the UI's wording switch.
export const isWorkCommentFailure = (v: unknown): v is WorkCommentFailure => FAILURES.some((failure) => failure === v);
