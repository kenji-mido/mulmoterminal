import { createGlobalFlag } from "./globalFlag";

// Whether a project with no `icon` of its own shows the favicon it already ships (#1428). ON
// unless explicitly disabled, unlike the opt-in flags: it displays a picture the repository
// already contains rather than creating anything. A project that wants none says `"icon": false`
// in its own file, so this control is only about the GLOBAL answer.
const flag = createGlobalFlag("autoDirIcon", true);

export const autoDirIcon = flag.state;
export const setAutoDirIcon = flag.set;
export const saveAutoDirIcon = flag.save;
