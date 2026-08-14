import { createGlobalFlag } from "./globalFlag";

// Whether a Markdown digest of the decisions this project's sessions asked for is kept, refreshed
// on a timer, for an agent to read before asking something similar (#1015). OFF unless asked for:
// it writes a file (under ~/.mulmoterminal/decisions/) that would otherwise never exist.
const flag = createGlobalFlag("decisionDigest", false);

export const decisionDigest = flag.state;
export const setDecisionDigest = flag.set;
export const saveDecisionDigest = flag.save;
