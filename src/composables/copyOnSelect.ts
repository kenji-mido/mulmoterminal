import { createGlobalFlag } from "./globalFlag";

// Whether a settled mouse selection goes straight to the clipboard (#900), hydrated from
// /api/config and read by every terminal's selection handler at event time. Off unless the config
// asks for it: it changes the clipboard with no key pressed, so it must never arrive by default.
//
// The selection handler uses `isCopyOnSelectEnabled`, which is also what keeps this module free of
// xterm imports; Settings renders `copyOnSelect`.
const flag = createGlobalFlag("copyOnSelect", false);

export const copyOnSelect = flag.state;
export const isCopyOnSelectEnabled = flag.read;
export const setCopyOnSelect = flag.set;
export const saveCopyOnSelect = flag.save;
