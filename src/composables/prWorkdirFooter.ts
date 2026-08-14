import { createGlobalFlag } from "./globalFlag";

// Whether a PR this app creates ends its body with `work in <clone name>` (#872), so a PR says
// which of several side-by-side clones produced it. ON unless explicitly disabled — the line is
// the whole point of the feature.
const flag = createGlobalFlag("prWorkdirFooter", true);

export const prWorkdirFooter = flag.state;
export const setPrWorkdirFooter = flag.set;
export const savePrWorkdirFooter = flag.save;
