import { createGlobalFlag } from "./globalFlag";

// Whether MulmoTerminal may comment on the issue a cell is working on (#979). Off unless asked
// for — it writes to GitHub, on issues that are often somebody else's.
const flag = createGlobalFlag("issueWorkComments", false);

export const issueWorkComments = flag.state;
export const isIssueWorkCommentsEnabled = flag.read;
export const setIssueWorkComments = flag.set;
export const saveIssueWorkComments = flag.save;
