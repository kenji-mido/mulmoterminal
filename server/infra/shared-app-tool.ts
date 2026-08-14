// manageSharedApp — MulmoTerminal's own tool for the shared-app operations.
//
// It is NOT an action on `manageCollection`. That tool's definition and dispatch both live in
// `@mulmoclaude/core`, so adding to it would be a change to MulmoClaude for a feature only
// MulmoTerminal has — the boundary this design fixed (D5). Core keeps the pure half: parsing the
// declaration, deciding what is wrong with it, projecting documents. What is here, and in
// `server/backends/sharedApp/`, is the operation: the order the documents are written in, and
// what a half-finished write leaves behind.
//
// There is exactly ONE write path to a shared app, and this is it. Core's whole-app `publishApp`
// was deleted rather than left unused (mulmoclaude #2871) because MulmoTerminal declares the
// shared-collections capability and binds the Firestore accessor — an action left in core would
// simply work here, and it wrote `public` without ever passing through staging.
import type { ToolDefinition } from "gui-chat-protocol";
import { deploySharedApp } from "../backends/sharedApp/deploy.js";
import { publishSharedApp } from "../backends/sharedApp/publish.js";
import { unpublishSharedApp } from "../backends/sharedApp/unpublish.js";
import { APP_ROLE_NAMES, checkSharedApp, forkSharedApp, initSharedApp, inviteToSharedApp, type AppRoleName } from "../backends/sharedApp/declare.js";
import { isRecord } from "../../common/isRecord.js";
import { manifestKey } from "../backends/sharedApp/manifestWrite.js";
import { serializeBy } from "../backends/sharedApp/serialize.js";

export const SHARED_APP_ACTIONS = ["init", "fork", "check", "invite", "deploy", "publish", "unpublish"] as const;
export type SharedAppAction = (typeof SHARED_APP_ACTIONS)[number];

export const MANAGE_SHARED_APP: ToolDefinition = {
  type: "function",
  name: "manageSharedApp",
  description:
    "Start, check, invite to, deploy, publish or unpublish this repository's shared app (the one declared by its app.json). " +
    "deploy stages the declaration and the collection schemas where only the app's roster can see them; publish promotes what was staged and opens the app to the public; unpublish closes it again.",
  prompt:
    "A request for something OTHER PEOPLE fill in or read — a survey, a sign-up sheet, a booking form, a form behind a link — is a shared app, and the `mulmoterminal-shared-app` skill is the path from that sentence to this tool. Read it before offering a printable page or a third-party form.\n" +
    "`manageSharedApp` operates on the repository the session is open in — the one holding `app.json` — and it is the only way to write a shared app.\n" +
    "**init** writes `app.json` for a repository that has none, with the SIGNED-IN address as its owner — use it instead of composing the file yourself, because the owner has to be the address this machine is signed in with and you cannot read that.\n" +
    "**fork** turns a CLONE of somebody else's shared app into the user's own — a new `aid`, a roster of one, the same collections. It is the answer to \"this repository is a clone, make it mine\", and the ONLY one: `init` refuses a repository that already declares an app, so composing the file by hand or deleting `app.json` first are both worse versions of this. It carries `collections` and `public` over unchanged, never touches `.claude/skills/`, and refuses outright when the signed-in address already owns the app.\n" +
    "**check** reports everything wrong with the declaration and this repository's shared collections WITHOUT writing or deploying anything. Run it after any edit to `app.json`; it is the only way to find out whether a declaration is deployable before it is deployed.\n" +
    "**invite** adds, changes or removes ONE address on the roster (`email`, `role`, optional `cid`; omit `role` to remove). It takes effect at the next deploy.\n" +
    "**deploy** is the safe one and is meant to be run often. It writes the roster and internal settings to `apps/{aid}` and each collection's schema to `apps/{aid}/staging/{cid}`, which only people on the roster can read. " +
    "An invitation added to `members` takes effect at deploy, so the roster can try the real app at `/staging/{aid}` before anybody outside sees it. Deploy never opens the app to the public, and never changes what a published app's visitors are looking at.\n" +
    "**publish** is the dangerous one. It promotes the STAGED schemas — not the working tree, so what ships is what the roster reviewed — and then opens the app. Publish it only when the user asks for it in those terms.\n" +
    "**unpublish** closes the app to the public and leaves the promoted schemas in place, so publishing again is a promotion rather than a rebuild.\n" +
    "Both deploy and publish refuse when live records would not satisfy the schema being written, and list the records. `confirm: true` overrides that refusal — ask the user first, and note that confirming a deploy does NOT carry over to publish: the second refusal is about the same records reaching everyone.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...SHARED_APP_ACTIONS],
        description:
          "init = write app.json for a new app; fork = take over a clone of somebody else's app; check = report what is wrong without writing; invite = one roster entry; deploy = stage for the roster; publish = promote the staged version and open it; unpublish = close it again.",
      },
      name: { type: "string", description: "init / fork: the app's human name. fork carries the cloned app's name over when this is omitted." },
      slug: {
        type: "string",
        description:
          "init / fork: the wanted URL name (lowercase, hyphens). It is a wish — a taken one gets a number appended. fork does NOT carry the cloned app's name over, so ask for one.",
      },
      email: { type: "string", description: "invite: the address to add, change or remove." },
      role: {
        type: "string",
        enum: [...APP_ROLE_NAMES],
        description:
          "invite: what they may do. Omit to REMOVE the address. owner publishes; editor writes records; viewer reads them; participant sees only its own rows; " +
          "assignee reads every row and writes only the ones assigned to it (needs collections.<cid>.assigneeField, and needs a cid — it cannot be app-wide).",
      },
      cid: { type: "string", description: "invite: one collection instead of the whole app. Defaults to the whole app." },
      confirm: {
        type: "boolean",
        description:
          "Write the schema although live records do not satisfy it. Applies to deploy and publish separately — a confirmed deploy still meets publish's own refusal.",
      },
    },
    required: ["action"],
  },
};

function parseAction(raw: unknown): SharedAppAction | null {
  if (typeof raw !== "string") return null;
  return SHARED_APP_ACTIONS.find((action) => action === raw) ?? null;
}

/** A stamp line both successes end with, because "which commit is this?" is the first question
 *  asked of a shared app that behaves unexpectedly — and `dirty` is the answer that matters, a
 *  commit that does not describe what was written being worse than no commit at all. */
function provenance(commit: string | undefined, dirty: boolean): string {
  if (commit === undefined) return "No commit was recorded (no git, or no commits yet).";
  return dirty ? `Recorded commit ${commit}, but the working tree was MODIFIED — the commit does not describe what was written.` : `Recorded commit ${commit}.`;
}

/** " at /sakura-hair", or nothing. Two of these rather than an inline conditional inside a
 *  template, because a sentence that reads well with and without the clause is the only thing
 *  worth optimising here. */
const at = (slug: string | undefined): string => (slug === undefined ? "" : ` at /${slug}`);

const noLonger = (slug: string | undefined): string => (slug === undefined ? "" : `, /${slug} no longer resolves`);

function recordNote(issues: number, capped: boolean): string[] {
  if (issues === 0) return [];
  const count = capped ? `at least ${issues}` : String(issues);
  return [`${count} live record${issues === 1 ? "" : "s"} do not satisfy the schema that was just written (you confirmed this) — they need repairing.`];
}

async function narrateDeploy(root: string, confirm: boolean): Promise<string> {
  const result = await deploySharedApp(root, { confirm });
  if (!result.ok) return result.problems.join("\n");
  const plural = result.cids.length === 1 ? "" : "s";
  return [
    `${result.created ? "Created" : "Updated"} apps/${result.aid} and staged ${result.cids.length} collection${plural}: ${result.cids.join(", ") || "(none)"}.`,
    `The roster can try it at /staging/${result.aid}. Nothing is public until you publish.`,
    ...(result.slug === undefined
      ? []
      : [
          `URL name held: '${result.slug}'. It starts resolving at /${result.slug} when you publish — until then nobody can look it up, which is what keeps /staging/{aid} unguessable.`,
        ]),
    ...(result.withdrawn.length > 0 ? [`Withdrawn from staging (no longer in this repository): ${result.withdrawn.join(", ")}.`] : []),
    ...recordNote(result.recordIssues, result.recordIssuesCapped),
    provenance(result.commit, result.dirty),
  ].join("\n");
}

async function narratePublish(root: string, confirm: boolean): Promise<string> {
  const result = await publishSharedApp(root, { confirm });
  if (!result.ok) return result.problems.join("\n");
  const plural = result.cids.length === 1 ? "" : "s";
  return [
    `Published apps/${result.aid}: promoted ${result.cids.length} staged collection${plural} (${result.cids.join(", ")}).`,
    result.publicOpen
      ? `The app is now OPEN to anonymous visitors${at(result.slug)}.`
      : "The app is NOT open to anonymous visitors — app.json declares no `public` block, so the promoted schemas are readable only by the roster.",
    ...recordNote(result.recordIssues, result.recordIssuesCapped),
    provenance(result.commit, result.dirty),
  ].join("\n");
}

async function narrateUnpublish(root: string): Promise<string> {
  const result = await unpublishSharedApp(root);
  if (!result.ok) return result.problems.join("\n");
  return result.wasOpen
    ? `Unpublished apps/${result.aid}: the public block is gone, so anonymous access is closed${noLonger(result.slug)}, and the public config document was deleted. ` +
        "The promoted schemas were left in place, so publishing again is a promotion."
    : `apps/${result.aid} was already closed to the public — nothing was open to take down. The public config document was deleted if it was still there.`;
}

async function narrateInit(root: string, body: Record<string, unknown>): Promise<string> {
  const result = await initSharedApp(root, str(body.name), str(body.slug));
  if (!result.ok) return result.problems.join("\n");
  return [
    `Started an app in this repository: app.json now declares it, with ${result.owner} as owner.`,
    "The `aid` was generated — it is the app's identity and is never chosen or edited by hand.",
    ...(result.slug === undefined ? [] : [`The wanted URL name is '${result.slug}'; deploy reserves it, and a taken one gets a number appended.`]),
    "Next: write the collections, then deploy.",
  ].join("\n");
}

/** `fork`'s report has one job the others do not: saying what did NOT come across. The roster and
 *  the URL name were in the file a moment ago and are not now, and a fork that silently kept
 *  either would be the bug this operation exists to prevent. */
async function narrateFork(root: string, body: Record<string, unknown>): Promise<string> {
  const result = await forkSharedApp(root, str(body.name), str(body.slug));
  if (!result.ok) return result.problems.join("\n");
  const carried =
    result.carried.length === 0
      ? "The cloned declaration had no `collections` or `public` block to carry over."
      : `Carried over unchanged: ${result.carried.join(", ")}.`;
  return [
    `This repository now declares YOUR app: a new aid, with ${result.owner} as owner and nobody else on the roster.`,
    carried,
    "The collection schemas under `.claude/skills/` were not touched — they are what was cloned, and they are the point.",
    ...urlName(result.slug, result.previousSlug),
    "Nothing is deployed: the app this was cloned from is untouched, and its records stay where they are. Next: deploy.",
  ].join("\n");
}

/** What to say about the URL name a fork has, or the one it deliberately does not have. */
function urlName(slug: string | undefined, previous: string | undefined): string[] {
  if (slug !== undefined) return [`The wanted URL name is '${slug}'; deploy reserves it, and a taken one gets a number appended.`];
  if (previous === undefined) return [];
  return [
    `No URL name: '${previous}' belongs to the app this was cloned from and was deliberately not carried — kept, it would have come back as '${previous}-2'. Ask the user what to call theirs and put it in \`slug\`.`,
  ];
}

async function narrateCheck(root: string): Promise<string> {
  const report = await checkSharedApp(root);
  if (!report.ok) return report.problems.join("\n");
  const found = report.collections.length === 0 ? "no shared collections in this repository yet" : `shared collections: ${report.collections.join(", ")}`;
  // WHOSE deploy was checked, always said out loud: signed in it is you, signed out it is the
  // owner the declaration names, and "it would deploy for somebody else" is not the same answer.
  const as =
    report.checkedAs === null
      ? `Checked as the declared owner (${report.declaredOwner ?? "none named"}) — not signed in, so it could not be checked against your address.`
      : `Checked as ${report.checkedAs}.`;
  if (report.problems.length === 0) {
    return [`The declaration is deployable. ${found}.`, as, "Nothing was written or deployed — this only reads."].join("\n");
  }
  return [`The declaration would be refused (${found}):`, ...report.problems.map((problem) => `  - ${problem}`), as, "Nothing was written."].join("\n");
}

async function narrateInvite(root: string, body: Record<string, unknown>): Promise<string> {
  const email = str(body.email);
  if (email === undefined) return "manageSharedApp invite: `email` is required — it is what the roster is keyed by.";
  const role = parseRole(body.role);
  if (role === undefined) return `manageSharedApp invite: role must be one of ${APP_ROLE_NAMES.join(", ")}, or omitted to remove the address.`;
  const cid = str(body.cid) ?? "*";
  const result = await inviteToSharedApp(root, email, role, cid);
  if (!result.ok) return result.problems.join("\n");
  const where = cid === "*" ? "the whole app" : `'${cid}'`;
  const what = role === null ? `Removed ${email} from ${where}.` : `${email} is now ${role} of ${where}.`;
  return [what, "It takes effect at the next deploy — nothing has changed in the app yet."].join("\n");
}

const str = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

/** `undefined` means the argument was not one of the roles — which is different from being ABSENT,
 *  and absent is how a removal is spelled. */
function parseRole(value: unknown): AppRoleName | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return APP_ROLE_NAMES.find((role) => role === value);
}

/** Run one action against `root` and narrate the result. The agent's whole contract with this
 *  tool is actionable prose, so a refusal is text and never a throw. */
export async function manageSharedApp(root: string, args: unknown): Promise<string> {
  const body = isRecord(args) ? args : {};
  const action = parseAction(body.action);
  if (action === null) return `manageSharedApp: action must be one of ${SHARED_APP_ACTIONS.join(", ")}.`;
  const confirm = body.confirm === true;
  // ONE operation at a time per repository. Each of these is a read-then-write sequence over the
  // same documents, and interleaved they undo each other: a publish that read the app document
  // before a deploy renamed the URL would go on to open the OLD name, which the deploy had just
  // retired — leaving a resolving name that no later unpublish touches, because unpublish works
  // from the record the deploy moved.
  //
  // At the entry point rather than inside each operation, because what must not interleave is the
  // whole sequence, and this is the only place they all pass through.
  const key = `operation:${await manifestKey(root)}`;
  if (action === "init") return serializeBy(key, () => narrateInit(root, body));
  if (action === "fork") return serializeBy(key, () => narrateFork(root, body));
  if (action === "check") return serializeBy(key, () => narrateCheck(root));
  if (action === "invite") return serializeBy(key, () => narrateInvite(root, body));
  if (action === "deploy") return serializeBy(key, () => narrateDeploy(root, confirm));
  if (action === "publish") return serializeBy(key, () => narratePublish(root, confirm));
  return serializeBy(key, () => narrateUnpublish(root));
}
