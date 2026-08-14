// The update status as the UI prints it: the launcher's one-line notice split for the header
// badge — the whole line is the tooltip, and the command after "run: " is pulled out so the badge
// can offer to copy just that (`git pull` / `npm i -g mulmoterminal`) — and the running version
// for the Settings line. Nothing to show answers null / empty, so both render nothing.
import type { UpdateStatus } from "../../common/updateStatus";

export interface UpdateBadge {
  text: string;
  command: string | null;
}

const RUN_MARKER = "run: ";

export function parseUpdateNotice(notice: string | null | undefined): UpdateBadge | null {
  if (!notice) return null;
  const at = notice.indexOf(RUN_MARKER);
  const command = at === -1 ? "" : notice.slice(at + RUN_MARKER.length).trim();
  return { text: notice, command: command || null };
}

/** The Settings version line, as its own labelled parts rather than one pre-joined string. */
export interface VersionDisplay {
  version: string;
  /** git checkouts only — shown next to the version, since that is what identifies the build. */
  commit: string | null;
}

/**
 * What is running, for the Settings line. A checkout also gets its commit: there the
 * package.json version is only whatever was last released, so the commit is the part that says
 * which build this is. Null until a status has been read, so the line renders nothing rather
 * than a version nobody is on.
 *
 * The commit appears only once the probe has landed (`ready`): before that the install kind is
 * still a placeholder, and an npm install would briefly claim a commit it does not have.
 */
export function versionDisplay(status: Pick<UpdateStatus, "ready" | "install" | "version" | "commit"> | null | undefined): VersionDisplay | null {
  if (!status) return null;
  return { version: status.version, commit: status.ready && status.install === "git" ? status.commit : null };
}
