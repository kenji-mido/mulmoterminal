// @vitest-environment node
//
// `init` mints the aid AND takes it, in that order, before anything reaches the disk.
//
// `apps/{aid}` is a shelf every user of the deployment shares, and its create rule asks only that
// you name yourself owner. The aid is minted into `app.json` — a file meant to be committed and
// read in a pull request. While the document stayed absent until the first deploy, anyone who read
// the file in that window could create it as themselves, and the id was gone for good: the real
// owner's write becomes an update they may not make, and no client may delete an app document.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setFirestoreAccessor, setSharedCollectionsSupport, type FirestoreDocs, type FirestoreDoc } from "@mulmoclaude/core/collection/server";
import { initCollectionsBackend } from "../../../server/backends/collections.js";
import { initSharedApp } from "../../../server/backends/sharedApp/declare.js";
import { makeTempDir } from "../../support/tempDir";

const OWNER = { uid: "uid-owner", email: "owner@example.com" };

/** Records the order of writes, because the order IS the property: a reservation that landed after
 *  the file would leave exactly the window this closes. */
class FakeDocs implements FirestoreDocs {
  readonly store = new Map<string, Record<string, unknown>>();
  readonly writes: string[] = [];
  refuseWrites = false;

  async set(collectionPath: string, id: string, doc: Record<string, unknown>): Promise<void> {
    if (this.refuseWrites) throw Object.assign(new Error("PERMISSION_DENIED: Missing or insufficient permissions."), { code: "permission-denied" });
    this.writes.push(`${collectionPath}/${id}`);
    this.store.set(`${collectionPath}/${id}`, doc);
  }
  async get(collectionPath: string, id: string): Promise<FirestoreDoc | null> {
    const data = this.store.get(`${collectionPath}/${id}`);
    return data === undefined ? null : ({ id, data } as FirestoreDoc);
  }
  async list(): Promise<FirestoreDoc[]> {
    return [];
  }
  async create(collectionPath: string, id: string, doc: Record<string, unknown>): Promise<boolean> {
    await this.set(collectionPath, id, doc);
    return true;
  }
  async delete(): Promise<boolean> {
    return true;
  }
  watch(): () => void {
    return () => {};
  }
}

describe("initSharedApp reserves the aid", () => {
  let docs: FakeDocs;
  let root: string;

  beforeAll(() => {
    initCollectionsBackend({ workspace: makeTempDir("mt-init-aid-ws-") });
    setSharedCollectionsSupport(true);
    setFirestoreAccessor(() => ({ docs, email: OWNER.email, uid: OWNER.uid }));
  });

  beforeEach(() => {
    docs = new FakeDocs();
    root = makeTempDir("mt-init-aid-");
  });

  it("writes the app document, and writes it before app.json exists", async () => {
    const result = await initSharedApp(root, "Talk survey", undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // One write, and it is the aid this init reported.
    expect(docs.writes).toEqual([`apps/${result.aid}`]);
    const doc = docs.store.get(`apps/${result.aid}`);
    // The roster, and NOTHING else: no `public`, no `collections`. The reservation says who owns
    // the id; it must not say anybody may read anything.
    expect(Object.keys(doc ?? {}).sort()).toEqual(["memberEmails", "members", "owner"]);
    expect(doc?.owner).toBe(OWNER.uid);
    expect(doc?.memberEmails).toEqual([OWNER.email]);

    // And the file agrees with the reservation.
    const manifest = JSON.parse(readFileSync(path.join(root, "app.json"), "utf-8")) as { aid: string };
    expect(manifest.aid).toBe(result.aid);
  });

  // The whole point of the ordering: a refused claim must leave the repository with no
  // declaration at all, so `init` can simply be run again.
  it("writes nothing to disk when the claim is refused", async () => {
    docs.refuseWrites = true;

    const result = await initSharedApp(root, "Talk survey", undefined);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems.join(" ")).toContain("cannot reserve the app");
    expect(!result.ok && result.problems.join(" ")).toContain("Nothing was written");
    expect(existsSync(path.join(root, "app.json"))).toBe(false);
  });

  // The reservation is live once it lands, so a failure after it is not "nothing happened". The
  // aid is named here because this is the only place it is ever said — it never reached a file.
  it("reports a partial and names the reserved aid when the file cannot be written", async () => {
    const missing = path.join(root, "no-such-directory");

    const result = await initSharedApp(missing, "Talk survey", undefined);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.partial).toBe(true);
    const said = result.problems.join(" ");
    expect(said).toContain("already reserved on the server");
    expect(said).toContain(String(docs.writes[0]));
    expect(existsSync(path.join(missing, "app.json"))).toBe(false);
  });

  it("still refuses a repository that already declares an app, without touching Firestore", async () => {
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ aid: "existing", members: {} }));

    const result = await initSharedApp(root, "Talk survey", undefined);

    expect(result.ok).toBe(false);
    expect(docs.writes).toEqual([]);
  });
});
