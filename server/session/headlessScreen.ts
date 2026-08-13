// Render a session's buffered PTY output into the screen it would have produced, for
// sessions tmux can't be asked about (tmux absent, or a non-persistent spawn). Feeds the
// bounded tail through a headless emulator and reads back the visible rows — the same
// restore the browser performs on reattach, minus the browser.
//
// Terminal queries are NOT stripped here (unlike the reattach replay): the emulator's
// replies go to an onData nobody listens to, and queries render nothing either way.
// Imported as a DEFAULT, not `import { Terminal }`. The package ships a UMD/CJS bundle
// and its `module` field points at a path that doesn't exist, so Node's ESM loader falls
// back to CJS and can't statically see the named export — a bare named import throws at
// startup under `node --import tsx`, even though bundlers (and vitest) resolve it fine.
import headless from "@xterm/headless";
import type { IBufferLine } from "@xterm/headless";
import type { ScreenRow } from "./screen-rows.js";

const { Terminal } = headless;

export interface HeadlessScreenInput {
  buffer: string;
  cols: number;
  rows: number;
  // How much scrollback to read above the visible pane, so this path yields the same
  // window as the tmux one (`capture-pane -S -n`).
  historyLines: number;
}

// Dim is read off the cells rather than re-parsed out of the buffer, so this path yields
// the same ScreenRow shape as a tmux capture and the suggestion rule stays single.
const rowOf = (line: IBufferLine | undefined, cols: number): ScreenRow => {
  if (!line) return { text: "", dim: "" };
  const cells = Array.from({ length: cols }, (_, column) => line.getCell(column));
  return {
    text: line.translateToString(true),
    dim: cells.flatMap((cell) => (cell?.isDim() ? [cell.getChars()] : [])).join(""),
  };
};

// `term.write` is ASYNC — the callback fires once the parser has consumed the chunk, and
// reading `buffer.active` before that yields an EMPTY screen. The await is load-bearing.
export async function renderScreen({ buffer, cols, rows, historyLines }: HeadlessScreenInput): Promise<ScreenRow[]> {
  // `buffer` is still proposed API in xterm 6; reading it (and the cells below) throws
  // without this opt-in. `scrollback` is stated rather than left at xterm's default, so
  // asking for more history than the emulator keeps can't silently return less.
  const term = new Terminal({ cols, rows, scrollback: historyLines, allowProposedApi: true });
  try {
    await new Promise<void>((resolve) => term.write(buffer, resolve));
    const active = term.buffer.active;
    // baseY is the top of the viewport, so reading from above it is what picks up the
    // scrollback — matching what `tmux capture-pane -S -n` returns. Clamped at 0: a
    // session with less history than asked for simply yields less.
    const top = Math.max(0, active.baseY - historyLines);
    return Array.from({ length: active.baseY - top + rows }, (_, row) => rowOf(active.getLine(top + row), cols));
  } finally {
    term.dispose();
  }
}
