// Where this app keeps the state that is not a user's config: managed worktrees, session
// registries, reservations.
//
// Read LAZILY, every time. MULMOTERMINAL_HOME redirects it — which is how a test works against a
// scratch directory instead of the real home — and a module-level constant computed at import
// would freeze the real path into a process that was pointed somewhere else.
import os from "node:os";
import path from "node:path";

export const mulmoterminalHome = (): string => process.env.MULMOTERMINAL_HOME || path.join(os.homedir(), ".mulmoterminal");
