import { createGlobalFlag } from "./globalFlag";

// Whether every spawned session carries the built-in closing-summary instructions (#942, opt-out
// in #1062). ON unless explicitly disabled: the grid is what it exists for. A directory's own
// `.mulmoterminal.json` outranks this, which is why Settings can only say what the GLOBAL answer
// is — a project that pins its own is unaffected by this control.
const flag = createGlobalFlag("appendSystemPrompt", true);

export const appendSystemPrompt = flag.state;
export const setAppendSystemPrompt = flag.set;
export const saveAppendSystemPrompt = flag.save;
