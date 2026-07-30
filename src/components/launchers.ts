import type { CellLauncher } from "./gridTabs";

// A user-configured launch command offered in the grid cell launcher (mirrors the
// server's Launcher in app-config.ts). `command` runs as an interactive persistent
// PTY; `label` is what the launcher button and the cell header show.
export interface Launcher {
  label: string;
  command: string;
}

// What a cell launcher emits when the user picks a program to launch: the launcher itself —
// a position in the configured list (the server's allowlist), or the OS default shell, which
// needs no list at all — plus the dir to run it in.
export interface LaunchPick {
  launcher: CellLauncher;
  cwd: string | null;
}
