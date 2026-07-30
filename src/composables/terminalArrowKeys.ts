// The bytes an arrow key sends, which are not one answer but two.
//
// A TUI in application-cursor-keys mode (DECCKM — Claude Code's own TUI, vim, less…) expects
// ESC O A; a normal shell expects ESC [ A. Send the wrong one and the key does nothing, or worse
// prints its escape. xterm tracks the mode, so the on-screen key bar can ask rather than guess.
//
// Pure and on its own, so the split is tested without standing up a terminal — and so the module
// that owns the sockets is not also the place this lives.
export type ArrowDir = "up" | "down" | "right" | "left";

const ARROW_FINAL: Record<ArrowDir, string> = { up: "A", down: "B", right: "C", left: "D" };

export function arrowSequence(dir: ArrowDir, appMode: boolean): string {
  return (appMode ? "\x1bO" : "\x1b[") + ARROW_FINAL[dir];
}
