// The HTML a published app shows instead of the generated form.
//
// A form is enough to ANSWER something and not enough to CHOOSE from what is
// available, so an app may name one HTML file and the public page renders it in
// a sandboxed iframe (mulmoserver `PublicViewFrame`). What the page holds is
// Firebase; what the view holds is the drawing.
//
// Three things about this file are decisions rather than plumbing:
//
//   WHERE IT LIVES. `public.view.path` is resolved against the REPOSITORY
//   ROOT — `app.json` is there, and a path written in a file is naturally
//   relative to that file. The alternative, resolving it inside one
//   collection's skill folder, asks which collection owns a page that belongs
//   to the whole app, and has no answer for an app with three of them.
//
//   IT IS A SEPARATE DOCUMENT. Firestore's 1 MiB limit is per document and
//   HTML is the part that grows, so the page's `config/public` (which every
//   visitor reads to draw anything at all) is not made hostage to it.
//
//   IT MUST BE DELETED, not merely stopped being written. `config/{docId}` is
//   `allow read: if true` forever: withdraw `public.view` from the declaration
//   and the old page stays fetchable by anyone until something removes it.
import { constants, lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import type { AuthoredApp } from "@mulmoclaude/core/collection/server";

/** The document the public page reads the HTML from. Beside core's
 *  `PUBLIC_CONFIG_DOC` ("public") under `apps/{aid}/config`. */
export const PUBLIC_VIEW_DOC = "view";

/** What publish writes there.
 *
 *  `publishedAt` is the same stamp `config/public` carries, and the runtime
 *  refuses to draw a pair that disagrees: the two are separate writes and a
 *  publish can stop between them, leaving a new declaration beside the previous
 *  page — a view handed fields it has never seen. */
export interface PublicViewDoc extends Record<string, unknown> {
  html: string;
  publishedAt: number;
}

/** How much of a Firestore document a published view may take.
 *
 *  The limit is 1 MiB and it applies to the DOCUMENT: field names, the UTF-8
 *  length of every string, and the document's own overhead. Measuring the file
 *  on disk would therefore be measuring the wrong thing — and being wrong here
 *  is not a smaller page but a refused write at publish time, or a page that
 *  cannot be updated.
 *
 *  The margin is deliberate. What is left of the megabyte is not ours to spend
 *  on being exact. */
const MAX_VIEW_BYTES = 900_000;

/** The bytes this document will occupy, near enough to refuse on.
 *
 *  Counted as the serialised document rather than as the HTML: the numbers a
 *  reader cares about — "how much have I got left" — must include everything
 *  the write carries, not just the part they wrote. */
export const viewDocumentBytes = (doc: PublicViewDoc): number => Buffer.byteLength(JSON.stringify(doc), "utf8");

export interface ViewFile {
  html: string;
  bytes: number;
}

export type ViewFileResult = { ok: true; view: ViewFile } | { ok: false; problems: string[] };

/** The host-side contract's name. A view written for the collection pane reads
 *  a capability token and a `dataUrl` off it, neither of which exists on the
 *  public page — so pointing `public.view` at one produces a blank page and no
 *  error anywhere. */
const HOST_VIEW_GLOBAL = "__MC_VIEW";

/** Read and judge the file `public.view.path` names.
 *
 *  Every refusal here is a thing the visitor would otherwise meet as an empty
 *  page: a path to nothing, a page too large to publish, or a view written
 *  against the host's bridge. */
export async function readPublicViewFile(root: string, view: { path: string }, publishedAt: number): Promise<ViewFileResult> {
  const inside = await containedPath(root, view.path);
  if (!inside.ok) return inside;

  const opened = await openContained(inside.full, view.path);
  if (!opened.ok) return opened;
  const bytes = viewDocumentBytes({ html: opened.html, publishedAt });
  return contentProblems(opened.html, bytes, view.path) ?? { ok: true, view: { html: opened.html, bytes } };
}

/** Read the file, through a handle that cannot be talked into reading another
 *  one.
 *
 *  Checking the path and then reading the path resolves it TWICE, and the
 *  second one is what gets published: a process that swaps the validated file
 *  for a symlink in between wins, and what lands on the world-readable document
 *  is whatever the link points at. So the containment check and the bytes have
 *  to be about the same object.
 *
 *  `O_NOFOLLOW` refuses at open time if the last component is a link, and
 *  everything after that — the type check and the read — goes through the
 *  descriptor rather than the name. The remaining theoretical window is an
 *  ANCESTOR directory replaced between `realpath` and this open; Node exposes
 *  no `openat`, so that one is named rather than closed.
 *
 *  Errors are values here for the same reason as everywhere else in this gate:
 *  publish answers with problems and writes nothing. */
/** The first directory between the repository and the view that is a symlink,
 *  or null when none is.
 *
 *  `O_NOFOLLOW` covers the last component only, so without this a `views/`
 *  replaced by a link would be followed. Checked with `lstat`, which does not
 *  follow, one component at a time.
 *
 *  This closes the MISTAKE — a stray link somebody made — completely. It does
 *  not close a race against a process that swaps a directory between this walk
 *  and the open below, and no pure-Node implementation can: that needs
 *  descriptor-relative opens (`openat`), which the runtime does not expose.
 *
 *  Which is worth stating precisely, because it bounds what this check is for.
 *  Publish reads the AUTHOR's own repository as the author. A process able to
 *  win that race is a process with write access to the repository being
 *  published — and it does not need a symlink at all: it can put the secret
 *  into `views/booking.html`, or rewrite `app.json`. The boundary this file
 *  guards is between a declaration and the world, not between two processes on
 *  one machine. */
async function symlinkedAncestor(root: string, dir: string): Promise<string | null> {
  let at = dir;
  while (at !== root && at.startsWith(root + path.sep)) {
    const info = await lstat(at).catch(() => null);
    if (info?.isSymbolicLink() === true) return at;
    at = path.dirname(at);
  }
  return null;
}

async function openContained(full: string, declared: string): Promise<{ ok: true; html: string } | { ok: false; problems: string[] }> {
  let handle;
  try {
    handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return {
      ok: false,
      problems: [
        `public.view.path names '${declared}', which could not be opened as a plain file in this repository. ` +
          "A published view is read without following links — what gets published is world-readable, so the file checked and the file read have to be the same one. " +
          "If it was there a moment ago, it has just been removed, replaced, or had its permissions changed. Nothing was written.",
      ],
    };
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      return { ok: false, problems: [`public.view.path names '${declared}', which is not a file.`] };
    }
    return { ok: true, html: await handle.readFile("utf8") };
  } catch {
    return {
      ok: false,
      problems: [`public.view.path names '${declared}', which could not be read. Nothing was written.`],
    };
  } finally {
    await handle.close().catch(() => {});
  }
}

/** Where the file must be, resolved ONCE, and the name it must have there.
 *
 *  The directory is resolved with `realpath` (so a repository reached through a
 *  symlinked parent is still judged fairly) and must be inside the repository.
 *  The BASENAME is deliberately left unresolved: resolving it would follow a
 *  link and hand back its target, so the check would be about one file and the
 *  read about another. Following it is refused outright at the open below.
 *
 *  What is published lands on a document whose rule is `allow read: if true`,
 *  so a mistake here is not a broken page but somebody's `.env` handed out. */
async function containedPath(root: string, declared: string): Promise<{ ok: true; full: string } | { ok: false; problems: string[] }> {
  const real = await realpath(root).catch(() => path.resolve(root));
  const wanted = path.resolve(real, declared);
  // The DECLARED components, before anything is resolved: resolving first
  // would replace a linked directory with its target, and there would be
  // nothing left to object to.
  const linked = await symlinkedAncestor(real, path.dirname(wanted));
  if (linked !== null) {
    return {
      ok: false,
      problems: [
        `public.view.path names '${declared}', and '${path.relative(real, linked) || linked}' on the way to it is a symbolic link. ` +
          "A published view is read without following links, directories included — what gets published is world-readable, so every step has to be inside the repository as written.",
      ],
    };
  }
  const dir = await realpath(path.dirname(wanted)).catch(() => path.dirname(wanted));
  if (dir === real || dir.startsWith(real + path.sep)) {
    return { ok: true, full: path.join(dir, path.basename(wanted)) };
  }
  return {
    ok: false,
    problems: [
      `public.view.path names '${declared}', which resolves outside this repository. ` +
        "A published view is one file inside it — what gets published is world-readable, so a path that leaves (through `..`, or through a symlinked directory) would hand out whatever it landed on.",
    ],
  };
}

function contentProblems(html: string, bytes: number, declared: string): { ok: false; problems: string[] } | null {
  if (bytes > MAX_VIEW_BYTES) {
    return {
      ok: false,
      problems: [
        `public.view.path names '${declared}', which comes to ${bytes.toLocaleString()} bytes as a Firestore document — over the ${MAX_VIEW_BYTES.toLocaleString()} this publishes. ` +
          "The hard limit is 1 MiB per document and it counts field names and string lengths, not the file on disk, so the margin is not spare room. " +
          "Move what is big out of the page: the datasets arrive from the app, not from the HTML.",
      ],
    };
  }
  if (html.includes(HOST_VIEW_GLOBAL)) {
    return {
      ok: false,
      problems: [
        `public.view.path names '${declared}', which reads \`${HOST_VIEW_GLOBAL}\` — that is the HOST's custom-view contract, where a view is handed a capability token and fetches its own data. ` +
          "The public page has neither: it reads Firestore itself and hands the view its data, and the view asks for writes through `window.__MC_PUBLIC_VIEW`. " +
          "Published as it stands, this page would render blank with nothing anywhere to say why. Write the public view against the public bridge.",
      ],
    };
  }
  return null;
}

/** The view the declaration asks to publish, if any. Null for an app with no
 *  `public.view` — which is most of them, and is not a problem. */
export const declaredView = (authored: AuthoredApp): { path: string } | null => authored.public?.view ?? null;
