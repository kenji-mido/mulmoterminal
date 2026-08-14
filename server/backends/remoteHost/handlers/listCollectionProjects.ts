// listCollectionProjects command handler.
//
// The other half of the project scope (../commandScope.ts): the handlers can already RESOLVE a
// project a command names, and this is how the phone LEARNS which ones there are. A picker needs
// `{ id, label }` pairs from the host and can invent neither.
//
// Mirrors GET /api/collection-projects, minus the `cwd`. The browser is handed each project's
// path because it has to MATCH a project to a cell it is already showing, and it knows every
// cell's cwd anyway. The phone has no such need and is a genuinely remote client, so the path
// stays here: an absolute root in a command or an artifact publishes the user's home directory
// over the wire, and the id is what the host resolves against its own list.
//
// The workspace is included and leads the list, as it does in the HTTP listing — a phone that
// wants "the host's own collections" names it like any other project rather than by omitting the
// parameter and hoping.
import { toJsonObject, type CommandHandlers } from "@mulmoclaude/core/remote-host";
import { listProjectRoots, type ProjectSummary } from "../../../infra/project-root.js";
import { lastSegment, pathSegments } from "../../../../common/pathSegments.js";

export const listCollectionProjects: CommandHandlers["listCollectionProjects"] = async () => toJsonObject({ projects: disambiguated(listProjectRoots()) });

/** How many parent directories a duplicated label may borrow to become distinct. Two is enough to
 *  separate `~/mulmoclaude` from `~/git/ai/mulmoclaude`, which is the real case; a cap is what
 *  keeps this from walking up to the home directory and sending the whole path after all. */
const MAX_BORROWED_SEGMENTS = 2;

/** Labels a person can tell apart, without sending a path.
 *
 *  Two saved directories can carry the SAME label — `cwdPresets` dedupes by path, and an
 *  auto-derived label is just the basename, so a repo and its clone are both "mulmoclaude" (this
 *  is the author's own config). The browser never had to care: its listing carries each project's
 *  `cwd` and it matches them to cells. The phone deliberately gets no path, so two identical rows
 *  would be two rows it cannot choose between — the picker would be a coin toss.
 *
 *  A duplicate therefore borrows the least it needs from its parent directories: `git/ai/mulmo…`
 *  is enough to tell two clones apart and is NOT the absolute root the no-path rule is about (the
 *  rule exists so a command or an artifact never publishes the user's home directory). If two
 *  still collide after `MAX_BORROWED_SEGMENTS`, the id's first characters break the tie — ugly,
 *  but ugly and distinct beats pretty and ambiguous. */
function disambiguated(projects: ProjectSummary[]): { id: string; label: string }[] {
  const named = projects.map((project) => ({ id: project.id, cwd: project.cwd, label: pathFreeLabel(project) }));
  const counts = new Map<string, number>();
  for (const project of named) counts.set(project.label, (counts.get(project.label) ?? 0) + 1);
  return named.map((project) => ({
    id: project.id,
    label: (counts.get(project.label) ?? 0) > 1 ? distinguish(project, named) : project.label,
  }));
}

/** The shortest tail of `cwd` that no other project shares, or the (already path-free) label plus
 *  an id fragment.
 *
 *  Every candidate is checked before it is returned, including the last one: this is the final
 *  thing between a config file full of arbitrary strings and a wire that promises no paths, so it
 *  ends by proving the answer rather than by trusting where the answer came from. */
function distinguish(project: SafeProject, projects: SafeProject[]): string {
  // BOTH separators: splitting on "/" alone leaves `C:\Users\me\project` as ONE segment, so the
  // "tail" would be the whole absolute path — the no-path rule silently off on Windows.
  const tailOf = (cwd: string, depth: number) => pathSegments(cwd).slice(-depth).join("/");
  for (let depth = 2; depth <= MAX_BORROWED_SEGMENTS + 1; depth += 1) {
    const tail = tailOf(project.cwd, depth);
    // A tail can fail in two ways, and BOTH have been shipped here: it can be a location in its
    // own right (a drive letter is a segment like any other), or it can be EMPTY — a filesystem
    // root has no segments to borrow, so the "distinguishing" label was a blank string.
    if (tail.length === 0 || looksLikePath(tail)) continue;
    const shared = projects.some((other) => other.id !== project.id && tailOf(other.cwd, depth) === tail);
    if (!shared) return tail;
  }
  // `project.label` is `pathFreeLabel`'s output, not the saved string — the type says so, which is
  // the point: a reader should not have to trace where it came from to know it is safe.
  return `${project.label} (${project.id.slice(0, 6)})`;
}

/** A project whose label has already been through `pathFreeLabel`. A nominal type would be
 *  heavier than this is worth; the name is what tells `distinguish` what it is holding. */
interface SafeProject {
  id: string;
  cwd: string;
  label: string;
}

/** A label with no path in it — ENFORCED here rather than assumed of what is stored.
 *
 *  `cwdPresets` labels are arbitrary strings: hand-edited, or written by an older version, or set
 *  to the directory itself. One that IS a path (`/Users/alice/work/private`) is perfectly unique,
 *  so nothing else on this path would look at it twice — and it would go out verbatim to a phone
 *  the protocol promises never receives one, publishing the user's home directory over the wire.
 *
 *  The no-path rule is this listing's to keep. A label that looks like a path is replaced by the
 *  directory's own name, and the FALLBACK is checked too, because it can fail the same test: a
 *  project at a filesystem root has no name to fall back to. */
function pathFreeLabel(project: ProjectSummary): string {
  const label = project.label.trim();
  if (label.length > 0 && !looksLikePath(label)) return label;
  const derived = lastSegment(project.cwd).trim();
  return derived.length > 0 && !looksLikePath(derived) ? derived : ROOT_LABEL;
}

/** What a project with no directory name of its own is called. Ambiguous between two roots by
 *  construction — which `disambiguated` then resolves, exactly as it does for any other pair
 *  sharing a label. */
const ROOT_LABEL = "root";

/** A separator, a home-relative `~`, or a drive letter — the ways a label carries location rather
 *  than a name. Deliberately broad: a false positive costs a nicer label, a false negative costs
 *  the guarantee. */
function looksLikePath(label: string): boolean {
  return (
    label.includes("\\") || label.startsWith("~") || label.startsWith("/") || /^[a-z]:/i.test(label) || label.split("/").some((part) => /^[a-z]:$/i.test(part))
  );
}
