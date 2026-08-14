// deploy — put the declaration where the ROSTER can see it, and nowhere else.
//
// It is the safe half of the split (design D10): everything it writes is readable only by people
// already on the roster, so it can be run as often as anyone likes. Two things are deliberately
// absent, and both are what make that true:
//
//   - the `public` block on `apps/{aid}`. That block is what the rules read to authorize
//     anonymous access — `publicOn` and `subOpen` read the APP document, never the world-readable
//     `config/public` projection — so writing it here would open the app the moment someone
//     deployed to test.
//   - the published schemas. They go to `staging/{cid}`, which only the roster can read, so a
//     deploy against a LIVE app does not swap the view its visitors are looking at.
//
// The write order is "app document first": `appSlugs`' create rule and the staging rules both
// resolve the owner through `get(apps/{aid})`, so on a first deploy nothing else is authorized
// until that document exists.
import { ensureAid } from "./ensureAid.js";
import { APPS_COLLECTION, appStagingPath, projectDeploy, type LoadedCollection, type PublishStamp } from "@mulmoclaude/core/collection/server";
import { gitStamp, readCurrentApp, schemasOf, sharedAppContext, type SharedAppFailure, type SharedAppHandle, type SharedAppOptions } from "./context.js";
import { recordRefusal, scanRecords, type RecordScan } from "./records.js";
import { reserveSlug, retireSlug, type SlugResult } from "./slug.js";
import { runWrites } from "./writes.js";

export interface DeploySuccess {
  ok: true;
  aid: string;
  cids: string[];
  created: boolean;
  commit?: string | undefined;
  dirty: boolean;
  /** How many live records the pre-check found that the staged schemas reject — and whether that
   *  number is a FLOOR (the scan stops at its cap per collection). The two travel together
   *  because they are read together: reporting the number without the flag understates how much
   *  repair is owed, on the one path (a confirmed deploy) where it is already staged. */
  recordIssues: number;
  recordIssuesCapped: boolean;
  /** The URL name this app holds, once one has been reserved. Absent when `app.json` declares no
   *  `slug` — an app reachable only at `/staging/{aid}` never needs one. */
  slug?: string | undefined;
  /** cids that were staged before and are not in the repository any more — dropped by this
   *  deploy. Reported because a withdrawal is not what the operator asked for; it is what
   *  deleting a collection's directory MEANT, and the two are easy to confuse. */
  withdrawn: string[];
}

/** Reserve the declared URL name if this app does not already hold it, and record the result on
 *  the app document so the next deploy does not reserve a SECOND one.
 *
 *  Undefined when the declaration names no slug: an app reachable only at `/staging/{aid}` never
 *  needs one, and reserving a name nobody asked for would take it from someone who did.
 *
 *  The extra app-document write is the price of the ordering: the reservation cannot be made
 *  before `apps/{aid}` exists, and what was reserved cannot be recorded before it is reserved. It
 *  happens only on the deploy that actually takes a name. */
async function reserveHeldSlug(
  handle: SharedAppHandle,
  aid: string,
  root: string,
  wanted: string | undefined,
  held: string | undefined,
  appDoc: Record<string, unknown>,
): Promise<SlugResult | undefined> {
  if (wanted === undefined) return undefined;
  // Whether the app is OPEN, from the document that decides it. The reservation's `published`
  // flag mirrors that, and a reclaim must not change the answer.
  const reservation = await reserveSlug(handle, aid, root, wanted, held === wanted, appDoc.public !== undefined);
  if (!reservation.ok || !reservation.reserved) return reservation;
  // A rename leaves the previous name pointing here, and a published one goes on RESOLVING —
  // while every later unpublish acts on the new name, so the URL the owner believes they took
  // down still opens the app. Retire it before the record moves, so a failure here leaves the
  // record on the old name and the next deploy repeats exactly this step.
  if (held !== undefined && held !== reservation.slug) {
    try {
      await retireSlug(handle, aid, held);
    } catch (err) {
      return {
        ok: false,
        partial: true,
        problems: [
          `the URL name '${reservation.slug}' was reserved, but the previous name '${held}' could not be retired: ${err instanceof Error ? err.message : String(err)}`,
          `Deploy again — until '${held}' is closed it still resolves to this app, and later unpublishes would not touch it.`,
        ],
      };
    }
  }
  try {
    await handle.docs.set(APPS_COLLECTION, aid, { ...appDoc, slug: reservation.slug });
  } catch (err) {
    return {
      ok: false,
      partial: true,
      problems: [
        `the URL name '${reservation.slug}' was reserved and written to app.json, but recording it on apps/${aid} failed: ${err instanceof Error ? err.message : String(err)}`,
        "Deploy again — the reservation is this app's, and the next deploy recognises that rather than taking a numbered name.",
      ],
    };
  }
  return reservation;
}

/** Write the roster when it is missing, then run the migration gate over the records — or the
 *  refusal that stops the deploy. Null when it may go on.
 *
 *  Split out for the line budget, but the two steps belong together anyway: the write is what
 *  makes the read possible, and doing them apart is what let a missing parent be mistaken for an
 *  empty store. */
async function establishAndScan(
  handle: SharedAppHandle,
  aid: string,
  appDoc: Record<string, unknown>,
  established: boolean,
  collections: readonly LoadedCollection[],
  root: string,
  confirm: boolean | undefined,
): Promise<{ ok: true; scan: RecordScan } | SharedAppFailure> {
  if (established) {
    const claimed = await claimApp(handle, aid, appDoc);
    if (claimed) return claimed;
  }
  const scan = await scanRecords(collections, root);
  const refusal = recordRefusal(scan, "deploy", confirm);
  if (!refusal) return { ok: true, scan };
  // The app document is live when this call created it just above — the roster, and nothing else.
  // Saying so is the difference between "nothing happened" and "the app exists now".
  return { ok: false, partial: established, problems: refusal };
}

/** Write the app document when it is not there — which is also the only way to LEARN whether it
 *  was ours to write.
 *
 *  `set` and not `create`. The create-if-absent primitive is a transaction that begins by READING
 *  the document, and that read is refused for exactly the document it is meant to create: the read
 *  rule resolves the roster out of the document itself, so for a missing one the expression fails
 *  and the answer is denied. The transaction dies there, every time, on a brand-new aid.
 *
 *  A `set` is subject to `allow create` when the document is absent and `allow update` when it is
 *  not — and both require this session to be the owner. So it succeeds exactly when the app is
 *  ours to write, and a refusal covers the two cases we cannot tell apart from here. The message
 *  names both, because both are things the operator can check. */
async function claimApp(handle: SharedAppHandle, aid: string, appDoc: Record<string, unknown>): Promise<SharedAppFailure | null> {
  try {
    await handle.docs.set(APPS_COLLECTION, aid, appDoc);
    return null;
  } catch (err) {
    return {
      ok: false,
      partial: false,
      problems: [
        `cannot write the app document (apps/${aid}): ${err instanceof Error ? err.message : String(err)}`,
        "Two things are refused the same way here, and both are worth checking:",
        `  - the address this session is signed in with is not the one app.json names as owner (it must be a key of \`members\` with \`"*": "owner"\`);`,
        `  - apps/${aid} already exists and belongs to somebody else's roster — this address was removed from it, or the aid came from a repository you are not on.`,
        "**Do not edit or remove `aid`.** It is the app's identity: a new one does not repair anything, it creates a SECOND app while the first — and everybody's records in it — stays where it is, reachable only by whoever is still on its roster. Recover access from an owner, or confirm this declaration is the app you meant.",
        "Nothing was written.",
      ],
    };
  }
}

/** Staged documents whose collection this repository no longer has.
 *
 *  Dropping them is what makes staging a REPLACEMENT of the repository's shared collections rather
 *  than an accumulation of everything ever deployed. Without it, deleting a collection leaves its
 *  schema staged forever, and publish — which promotes what is staged and refuses to promote a
 *  version it cannot check against the repository — has no way forward at all.
 *
 *  Always asked, because by the time it runs the app document EXISTS: either it already did, or
 *  this deploy has just written it. That matters for a resurrected aid — Firestore leaves
 *  `staging/*` behind exactly as it leaves the records — where skipping the listing would carry an
 *  orphaned staged collection through a successful deploy and into a publish that then fails
 *  closed. For a genuinely new aid the listing is simply empty. */
async function staleStaged(
  handle: SharedAppHandle,
  aid: string,
  keep: ReadonlySet<string>,
  established: boolean,
): Promise<{ ok: true; cids: string[] } | SharedAppFailure> {
  try {
    const staged = await handle.docs.list(appStagingPath(aid));
    return { ok: true, cids: staged.map((doc) => doc.id).filter((cid) => !keep.has(cid)) };
  } catch (err) {
    return {
      ok: false,
      // The roster is LIVE when this deploy created it a moment ago, and a failure report that
      // says "nothing was written" about an app that now exists is worse than no report.
      partial: established,
      problems: [
        `deploy failed while reading what is already staged (apps/${aid}/staging): ${err instanceof Error ? err.message : String(err)}`,
        established ? "The app document was written and the roster is live; nothing was staged. Deploying again continues from here." : "Nothing was written.",
        "This read is what lets a deleted collection be withdrawn from staging, so deploying without it would leave a stale schema behind for publish to trip over.",
      ],
    };
  }
}

export type DeployResult = DeploySuccess | SharedAppFailure;

export async function deploySharedApp(root: string, opts: SharedAppOptions = {}): Promise<DeployResult> {
  // Before anything reads the declaration: a repository that has never been deployed has no
  // `aid` yet, and it is generated here rather than invented by the agent (D2b).
  const ensured = await ensureAid(root);
  if (!ensured.ok) return { ok: false, partial: false, problems: ensured.problems };

  const context = await sharedAppContext(root);
  if (!context.ok) return context;
  const { authored, collections, handle } = context;

  const { aid } = authored;
  // WHAT THE APP DOCUMENT IS, asked in the only way the rules allow.
  //
  // Reading `apps/{aid}` cannot tell you it is missing. The read rule resolves the roster out of
  // the document itself (`readerOf(app(aid), '*')`), so for a document that does not exist the
  // expression fails and the answer is DENIED — the same answer as somebody else's app. A first
  // deploy therefore cannot start by reading, and did not: it reported
  // "Missing or insufficient permissions" and stopped, with nothing else to try.
  //
  // So a denial is not conclusive here, and the CREATE is what settles it (below): create-if-absent
  // is atomic, and only the declared owner may do it.
  const current = await readCurrentApp(handle, aid, "deploy", "Deploying again is safe — this read only decides whether the app is created or updated.");
  if (!current.ok) return current;
  const stampSource = await (opts.resolveCommit ?? gitStamp)(root);
  const stamp: PublishStamp = {
    uid: handle.uid,
    email: handle.email,
    publishedAt: (opts.now ?? Date.now)(),
    commit: stampSource.commit,
    dirty: stampSource.dirty,
  };
  const existingApp = current.app;
  const deployed = projectDeploy(authored, schemasOf(collections), stamp, existingApp);

  // The slug this app already holds, carried on the app document because NOTHING ELSE CAN BE
  // ASKED: `appSlugs/{slug}` is unreadable until the app is published, so "do we already have
  // one?" has no other answer. `projectDeploy` does not carry it — the reservation is the host's
  // business and core has no opinion about it — so it is re-attached here, from the document as
  // it stands, on every deploy.
  const held = typeof existingApp?.slug === "string" ? existingApp.slug : undefined;
  const appDoc = held === undefined ? deployed.app : { ...deployed.app, slug: held };

  // ESTABLISH THE PARENT, THEN SCAN — rather than deciding that a missing app document means there
  // are no records.
  //
  // It does not. Firestore deletes do not cascade, and this design documents the orphan state that
  // leaves: `apps/{aid}` can be gone while `collections/*/items` beneath it survives. Reading the
  // missing parent as an empty store would let a deploy that re-creates it make those records
  // readable under a schema nothing ever checked them against.
  //
  // Writing the roster first is what makes the question ANSWERABLE. It grants nothing outside the
  // roster — no `public` block is written here, ever — it is the same document this deploy is
  // about to write anyway, and afterwards the records can be read. So the gate runs for real: on a
  // new app it finds nothing, and on a resurrected aid it finds whatever survived.
  const established = existingApp === null;
  const gate = await establishAndScan(handle, aid, appDoc, established, collections, root, opts.confirm);
  if (!gate.ok) return gate;
  const { scan } = gate;

  const stale = await staleStaged(handle, aid, new Set(deployed.staging.map((entry) => entry.cid)), established);
  if (!stale.ok) return stale;

  const failure = await runWrites(
    [
      // Not written again when the step above just wrote it, byte for byte: the roster is already
      // live, and the staging writes below need exactly that and nothing more.
      ...(established ? [] : [{ what: `the app document (apps/${aid})`, run: () => handle.docs.set(APPS_COLLECTION, aid, appDoc) }]),
      ...deployed.staging.map(({ cid, doc }) => ({
        what: `the staged schema for '${cid}' (apps/${aid}/staging/${cid})`,
        run: () => handle.docs.set(appStagingPath(aid), cid, doc),
      })),
      // Withdrawals last: they grant nothing, and doing them after the writes keeps a failure
      // part-way through from leaving the roster with fewer collections than it had.
      ...stale.cids.map((cid) => ({
        what: `the withdrawal of the staged schema for '${cid}' (apps/${aid}/staging/${cid})`,
        run: async (): Promise<void> => {
          await handle.docs.delete(appStagingPath(aid), cid);
        },
      })),
    ],
    "deploy",
  );
  if (failure) return failure;

  // AFTER the app document, because `appSlugs`' create rule resolves the owner through
  // `get(apps/{aid})` — on a first deploy there is nothing to resolve until it exists.
  const slug = await reserveHeldSlug(handle, aid, root, authored.slug, held, appDoc);
  if (slug !== undefined && !slug.ok) return slug;

  return {
    ok: true,
    aid,
    slug: slug?.slug,
    cids: deployed.staging.map((entry) => entry.cid),
    withdrawn: stale.cids,
    // "Created" means THIS deploy is the first, and that is no longer the same question as
    // "the document was absent": `init` reserves `apps/{aid}` before it writes `app.json`, so the
    // document exists from the moment the app is declared. `deployedAt` is written by every
    // deploy and by nothing else, so its absence is the first-deploy signal that survives the
    // reservation.
    created: existingApp === null || existingApp.deployedAt === undefined,
    commit: stamp.commit,
    dirty: stampSource.dirty === true,
    recordIssues: scan.records,
    recordIssuesCapped: scan.capped,
  };
}
