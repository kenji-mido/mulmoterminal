import { worktreeLabel } from "./cwdDisplay";
import { isSameDirPath } from "../../common/dirPathKey";

// A directory preset offered as a one-click chip in the cell launch form.
// The list is auto-populated from the dirs the user launches in (see
// useAppConfig.recordPreset) and pruned with the chip's close button.
export interface CwdPreset {
  label: string;
  path: string;
}

// Chip label for an auto-recorded dir: a managed worktree shows
// "repo (task)"; any other path shows its trailing segment (basename).
export function presetLabel(path: string): string {
  const wt = worktreeLabel(path);
  if (wt) return `${wt.repo} (${wt.task})`;
  const segments = path.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

/** A chip as the launcher renders it: a preset, plus whether it is THE workspace. */
export interface LaunchChip extends CwdPreset {
  isWorkspace: boolean;
}

/**
 * What the workspace is CALLED, rather than what its directory is called.
 *
 * Every other chip is a place — the basename of somewhere you launched. This one is a ROLE: the
 * directory a session works from, where every GUI tool is reachable and the shared wiki /
 * collections / accounting live. Naming it `mulmoclaude` (or whatever the folder happens to be)
 * says the least interesting true thing about it, and reads as one project among the others.
 *
 * Capitals because it is not a directory name and should not read as one — every neighbour is a
 * lowercase basename. The real path has not gone anywhere: it is the chip's hover, which is where
 * the other chips keep theirs too.
 *
 * Used by the launcher chip AND by a cell header's DirBadge, which is why it is not called
 * CHIP_LABEL any more: the two used to disagree, so launching from a chip labelled WORKSPACE gave
 * you a cell badged with whatever `name` that folder's `.mulmoterminal.json` happened to carry —
 * one directory wearing two names across a single click.
 */
export const WORKSPACE_LABEL = "WORKSPACE";

/**
 * The chips to render: the workspace FIRST and always, then the recent directories.
 *
 * The workspace is not an ordinary recent dir, and the launcher used to treat it as one — it
 * appeared only if you had happened to launch there and had not since removed it, because the list
 * is auto-recorded by `recordPreset`. But it is the one directory where every GUI tool is reachable
 * (see `carriesFullGuiMcp` on the server), so being unable to get to it from the launcher is
 * exactly backwards. It is synthesised here rather than written into the user's saved presets:
 * nothing about it needs storing, and a stored copy would go stale the moment CLAUDE_CWD changed.
 *
 * Pinned ahead of the priority ordering on purpose. `orderByDirPriority` ranks the directories a
 * user configured against each other; the workspace is not competing in that ranking.
 *
 * It is labelled by its ROLE, not by its directory name — see WORKSPACE_LABEL. Matched with
 * `isSameDirPath`, the same lexical comparison the worktree rows use: the browser cannot resolve a
 * symlink, so this folds only the spellings a person types (a trailing slash, a `..`). Getting it
 * wrong shows the directory twice — the server still decides what the workspace really is, with a
 * realpath.
 */
export function launchChips(orderedPresets: readonly CwdPreset[], defaultCwd: string | null | undefined): LaunchChip[] {
  const rest = orderedPresets.filter((p) => !defaultCwd || !isSameDirPath(p.path, defaultCwd)).map((p) => ({ ...p, isWorkspace: false }));
  if (!defaultCwd) return rest;
  return [{ label: WORKSPACE_LABEL, path: defaultCwd, isWorkspace: true }, ...rest];
}
