// publish — promote what the roster tested, and open it LAST.
//
// The one dangerous operation in a shared app (design D10). Merging a pull request changes
// nobody's screen; publishing changes everyone's, immediately, and in two ways at once: a breaking
// schema change leaves live records inconsistent with the schema that is now supposed to describe
// them, and — because a view is HTML — the right to publish is in practice the right to run
// JavaScript in every member's browser.
//
// Two properties are load-bearing and neither is obvious from the call site:
//
//   - it PROMOTES `staging/{cid}` rather than re-projecting the working tree, so what shipped is
//     what the roster reviewed;
//   - it writes `apps/{aid}.public` LAST, as its own write, because that block — not the
//     world-readable `config/public` projection — is what the rules read to authorize anonymous
//     access. A run that stops part-way therefore leaves the app private.
//
// A re-publish passes through a moment with no `public` block. That is a brief denial for
// visitors, not a brief exposure, and it is the trade the ordering is chosen for.
//
// The other half of that trade, stated because it is what an ordering review asks about: while a
// LIVE app is being re-published, the OLD `public` block stays in force across the promotions, so
// a run that fails part-way leaves the app open on a mixed set of versions. That is accepted, and
// it is not an access change — the old block is what authorizes those reads, so a collection that
// only the NEW declaration would have opened stays closed (`publicRead` tests the cid against the
// `public.read` list that is still live). Closing first would trade a mixed-version window for a
// deliberate outage on every re-publish, and a failure there leaves the app DARK rather than
// stale — worse for the person the app is for, and not what the design chose (see D10's ordering).
import { isRecord } from "../../../common/isRecord.js";
import {
  APPS_COLLECTION,
  PUBLIC_CONFIG_DOC,
  appConfigPath,
  appSchemasPath,
  promoteSchema,
  projectPublish,
  stagedRuleConfig,
  type AuthoredApp,
  type LoadedCollection,
  type PublishStamp,
} from "@mulmoclaude/core/collection/server";
import { ensureAid } from "./ensureAid.js";
import { gitStamp, sharedAppContext, type SharedAppFailure, type SharedAppHandle, type SharedAppOptions } from "./context.js";
import { recordRefusal, scanRecords, type RecordScan } from "./records.js";
import { readStaged, type StagedEntry } from "./staged.js";
import { oversizeProblem, publicFormOf, publicInputProblems, type PublicForm } from "./publicForm.js";
import { PUBLIC_VIEW_DOC, declaredView, readPublicViewFile, type ViewFile } from "./publicView.js";
import { frozenKeyProblems } from "./exclusivity.js";
import { stagedScopeProblems } from "./scopedFields.js";
import { setSlugPublished } from "./slug.js";
import { runWrites, type WriteStep } from "./writes.js";

export interface PublishSuccess {
  ok: true;
  aid: string;
  cids: string[];
  /** The URL name that now resolves to this app, when it has one. */
  slug?: string | undefined;
  /** Whether this publish left the app open to anonymous visitors. False is a normal outcome — a
   *  declaration with no `public` block publishes the schemas to the roster's URL and grants the
   *  world nothing — and it is the one thing an operator is most likely to assume wrongly. */
  publicOpen: boolean;
  commit?: string | undefined;
  dirty: boolean;
  recordIssues: number;
  recordIssuesCapped: boolean;
}

export type PublishResult = PublishSuccess | SharedAppFailure;

/** The staged version as something the record scan can run against: this repository's collection,
 *  with the STAGED schema in place of the one on disk.
 *
 *  Validating the working tree's schema would answer the wrong question — the tree may have moved
 *  on since the deploy, and the version being promoted is the staged one. */
function stagedForValidation(
  staged: readonly StagedEntry[],
  collections: readonly LoadedCollection[],
): { ok: true; collections: LoadedCollection[] } | { ok: false; problems: string[] } {
  const byCid = new Map(collections.map((collection) => [collection.slug, collection]));
  const scanned: LoadedCollection[] = [];
  const problems: string[] = [];
  for (const entry of staged) {
    const collection = byCid.get(entry.cid);
    if (!collection) {
      // Fail closed rather than promote it unchecked: the records live in the app and would be
      // read under this schema by everyone, and nothing here can tell whether they still fit.
      problems.push(
        `'${entry.cid}' is staged but is not a collection in this repository any more, so its live records cannot be checked against the version about to be published. ` +
          "Run deploy again — it re-stages what the repository actually has and drops what it does not.",
      );
      continue;
    }
    scanned.push({ ...collection, schema: entry.doc.publishedSchema });
  }
  // The other direction, and the one that is not symmetric with it: a collection the repository
  // HAS and staging does not.
  //
  // "staging is non-empty" is not the same question. A deploy writes the staged documents one at
  // a time, so one that failed part-way leaves a NONEMPTY but incomplete set — and publishing that
  // opens an app whose declaration names a collection with no published schema behind it. The
  // deploy said so at the time, but publish must not be the step that ships the subset anyway.
  //
  // It also catches the ordinary version of the same mistake: a collection added to the
  // repository and never deployed. Both answers are the same one — run deploy first.
  const stagedCids = new Set(staged.map((entry) => entry.cid));
  const missing = collections.map((collection) => collection.slug).filter((cid) => !stagedCids.has(cid));
  if (missing.length > 0) {
    problems.push(
      `not staged, so there is no reviewed version to promote: ${missing.join(", ")}. ` +
        "Run deploy first — publishing now would open the app with those collections missing from it, which is not the version anybody reviewed at /staging.",
    );
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, collections: scanned };
}

/** The writes, in the order the design fixes: promote, project, then open. */
function publishSteps(
  handle: SharedAppHandle,
  aid: string,
  staged: readonly StagedEntry[],
  stamp: PublishStamp,
  face: ReturnType<typeof projectPublish>,
  slug: string | undefined,
  form: PublicForm,
  view: ViewFile | null,
): WriteStep[] {
  return [
    ...staged.map(({ cid, doc }) => ({
      what: `the published schema for '${cid}' (apps/${aid}/collections/${cid})`,
      run: () => handle.docs.set(appSchemasPath(aid), cid, promoteSchema(doc, stamp)),
    })),
    {
      what: `the public config document (apps/${aid}/config/${PUBLIC_CONFIG_DOC})`,
      // `form` is MulmoTerminal's addition to core's projection, and it has to be here rather
      // than anywhere else: this is the ONLY document a visitor may read, and without the labels
      // and the choices the public page cannot draw the form at all (the schema is unreadable to
      // somebody who is neither on the roster nor granted a public read).
      run: () => handle.docs.set(appConfigPath(aid), PUBLIC_CONFIG_DOC, { ...face.config, form }),
    },
    // The page itself, carrying the SAME stamp as the config above. The
    // runtime refuses to draw a pair that disagrees, and these are two writes:
    // a run that stops between them leaves a new declaration beside the
    // previous page, which is a view handed fields it has never seen.
    //
    // The DELETE is not tidiness. `config/{docId}` is `allow read: if true`
    // forever, so a view withdrawn from the declaration and merely not
    // rewritten stays fetchable by anybody who asks for it.
    {
      what:
        view === null ? `removing the published view (apps/${aid}/config/${PUBLIC_VIEW_DOC})` : `the published view (apps/${aid}/config/${PUBLIC_VIEW_DOC})`,
      run: async () => {
        if (view === null) {
          await handle.docs.delete(appConfigPath(aid), PUBLIC_VIEW_DOC);
          return;
        }
        await handle.docs.set(appConfigPath(aid), PUBLIC_VIEW_DOC, { html: view.html, publishedAt: stamp.publishedAt });
      },
    },
    // The app document WITHOUT `public`: the promoted rule configuration lands with the schemas it
    // was staged beside, so the public write path is never judged by one version's constraints
    // against another's schema.
    { what: `the app document (apps/${aid})`, run: () => handle.docs.set(APPS_COLLECTION, aid, face.app) },
    // The URL name follows the app's own openness — `face.public` — and NOT the fact that a
    // publish happened.
    //
    // A published reservation is world-readable, and what it reveals is the aid, which is the
    // `/staging/{aid}` entrance this whole feature keeps unguessable. So publishing a declaration
    // with no `public` block — a roster-only app, which is a normal thing to publish — must not
    // make its name resolvable: that would hand out the private entrance while the operation
    // itself reports the app is closed to anonymous visitors.
    //
    // Placed here, before the authorization and after everything the name points at: a slug that
    // resolved first would be a link that 404s inside, and one that resolves late is only a link
    // that is not ready yet. When the publish CLOSES the app instead, the same position is the
    // reverse and equally right — the app document above has already dropped `public`.
    ...(slug === undefined
      ? []
      : [{ what: `the URL name '${slug}' (appSlugs/${slug})`, run: () => setSlugPublished(handle, aid, slug, face.public !== undefined) }]),
    // LAST, and only when the declaration asks for it. This is the authorization itself.
    ...(face.public === undefined
      ? []
      : [
          {
            what: `the public block on apps/${aid} — the authorization itself`,
            run: () => handle.docs.set(APPS_COLLECTION, aid, { ...face.app, public: face.public }),
          },
        ]),
  ];
}

/** Everything that must hold before a promotion: something IS staged, the staged set matches the
 *  repository, and the live records fit the version about to become public. Split out for the
 *  line budget, and it reads as the one thing it is — the gate. */
async function stagedGate(
  authored: AuthoredApp,
  staged: readonly StagedEntry[],
  collections: readonly LoadedCollection[],
  aid: string,
  root: string,
  confirm: boolean | undefined,
): Promise<{ ok: true; scan: RecordScan } | SharedAppFailure> {
  if (staged.length === 0) {
    return {
      ok: false,
      partial: false,
      problems: [
        `nothing is staged for apps/${aid}, so there is nothing to promote. Run deploy first — publish promotes what the roster reviewed at /staging/${aid} rather than reading the working tree.`,
      ],
    };
  }
  const toScan = stagedForValidation(staged, collections);
  if (!toScan.ok) return { ...toScan, partial: false };
  // Against the STAGED schemas, not the tree the deploy gate already checked: the declaration can
  // have gained a field since, and publishing it would make the rules demand a field the form
  // cannot draw.
  const drifted = publicInputProblems(
    authored,
    staged.map((entry) => ({ cid: entry.cid, schema: entry.doc.publishedSchema })),
    "staged",
  );
  if (drifted.length > 0) return { ok: false, partial: false, problems: drifted };
  // The PAIR publish actually writes: the staged rule configuration and schemas
  // on one side, the manifest's roster on the other. Neither the deploy gate nor
  // the drift check above looks at that combination, and it is where an
  // `assignee` can end up with no field to be compared against.
  const scoped = stagedScopeProblems(authored, staged);
  if (scoped.length > 0) return { ok: false, partial: false, problems: scoped };
  const scan = await scanRecords(toScan.collections, root);
  const refusal = recordRefusal(scan, "publish", confirm);
  return refusal ? { ok: false, partial: false, problems: refusal } : { ok: true, scan };
}

/** The two questions that are asked of the PAGE and of the live records before
 *  anything is written — both of them things a run cannot take back once the
 *  schemas have been promoted.
 *
 *  Together because they share that timing, not because they are alike: one
 *  reads a file off disk, the other reads what the app already holds. */
async function pageGate(
  root: string,
  authored: AuthoredApp,
  staged: readonly StagedEntry[],
  live: Record<string, unknown> | null,
  handle: SharedAppHandle,
  publishedAt: number,
): Promise<{ ok: true; view: ViewFile | null } | { ok: false; problems: string[] }> {
  const declared = declaredView(authored);
  const view = declared === null ? null : await readPublicViewFile(root, declared, publishedAt);
  if (view !== null && !view.ok) return view;
  // The other question about the same live records, and the one the migration
  // scan cannot ask: not "do these rows still fit the schema" but "does this
  // change move the id space they were written into". See ./exclusivity.ts —
  // `confirm` deliberately does not reach it.
  //
  // The collection half is read from what DEPLOY staged, because that is what
  // this publish promotes: `stagedRuleConfig` is the same function the
  // projection uses, so the value judged is the value written.
  // Copied because `stagedRuleConfig` takes a mutable array; the entries
  // themselves are not touched.
  const frozen = await frozenKeyProblems(authored, stagedRuleConfig([...staged]).collections ?? {}, live, handle);
  if (frozen.length > 0) return { ok: false, problems: frozen };
  return { ok: true, view: view === null ? null : view.view };
}

export async function publishSharedApp(root: string, opts: SharedAppOptions = {}): Promise<PublishResult> {
  // Before anything reads the declaration: a repository that has never been deployed has no
  // `aid` yet, and it is generated here rather than invented by the agent (D2b).
  const ensured = await ensureAid(root);
  if (!ensured.ok) return { ok: false, partial: false, problems: ensured.problems };

  const context = await sharedAppContext(root);
  if (!context.ok) return context;
  const { authored, collections, handle } = context;
  const { aid } = authored;

  const staged = await readStaged(handle, aid);
  if (!staged.ok) return { ...staged, partial: false };
  const gate = await stagedGate(authored, staged.staged, collections, aid, root, opts.confirm);
  if (!gate.ok) return gate;
  const scan = gate.scan;

  let existing: unknown;
  try {
    existing = await handle.docs.get(APPS_COLLECTION, aid);
  } catch (err) {
    return {
      ok: false,
      partial: false,
      problems: [
        `publish failed while reading the current app document (apps/${aid}): ${err instanceof Error ? err.message : String(err)}`,
        "Nothing was written. Publishing again is safe — this read carries `owner` forward and decides what a rollback would restore.",
      ],
    };
  }
  const stampSource = await (opts.resolveCommit ?? gitStamp)(root);
  const stamp: PublishStamp = {
    uid: handle.uid,
    email: handle.email,
    publishedAt: (opts.now ?? Date.now)(),
    commit: stampSource.commit,
    dirty: stampSource.dirty,
  };
  const existingApp = isRecord(existing) ? existing : null;
  const face = projectPublish(authored, staged.staged, stamp, existingApp);

  // The name this app HOLDS, which is the app document's — not necessarily the one `app.json`
  // wants right now. An author who edits `slug` between deploy and publish has changed what the
  // next deploy will reserve, not what this publish may flip: flipping a name this app never
  // reserved is a write the rules refuse, and that refusal is the point of them.
  const slug = typeof existingApp?.slug === "string" ? existingApp.slug : undefined;

  const form = publicFormOf(authored, staged.staged);
  // Before the first write: the config document is written in the middle of the run, so a database
  // refusal there would land with the schemas already promoted.
  const oversize = oversizeProblem({ ...face.config, form });
  if (oversize !== null) return { ok: false, partial: false, problems: [oversize] };

  // Also before the first write, and for the same reason: the page is read
  // from disk and judged here, so a missing file or one written against the
  // host's bridge stops the run rather than landing after the schemas have
  // been promoted.
  const page = await pageGate(root, authored, staged.staged, existingApp, handle, stamp.publishedAt);
  if (!page.ok) return { ok: false, partial: false, problems: page.problems };

  const failure = await runWrites(publishSteps(handle, aid, staged.staged, stamp, face, slug, form, page.view), "publish");
  if (failure) return failure;

  return {
    ok: true,
    aid,
    cids: staged.staged.map((entry) => entry.cid),
    publicOpen: face.public !== undefined,
    slug,
    commit: stamp.commit,
    dirty: stampSource.dirty === true,
    recordIssues: scan.records,
    recordIssuesCapped: scan.capped,
  };
}
