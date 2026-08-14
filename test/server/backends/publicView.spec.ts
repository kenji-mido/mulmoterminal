// @vitest-environment node
//
// The page a published app shows instead of the generated form, and the keys
// that must not move once anything has claimed a document.
//
// Both are gates: they refuse before the first write, because everything they
// guard against is invisible afterwards. A view that cannot be drawn shows a
// visitor "there is nothing here"; an id space that moved leaves old records
// holding nothing, in an app that goes on working.
import { describe, it, expect, beforeEach } from "vitest";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AuthoredApp, FirestoreDoc, FirestoreDocs } from "@mulmoclaude/core/collection/server";
import { readPublicViewFile, viewDocumentBytes } from "../../../server/backends/sharedApp/publicView.js";
import { frozenKeyProblems } from "../../../server/backends/sharedApp/exclusivity.js";
import { makeTempDir } from "../../support/tempDir";

const AID = "11111111-2222-3333-4444-555555555555";
const STAMP = 1_700_000_000_000;

const withView = (root: string, html: string): string => {
  mkdirSync(path.join(root, "views"), { recursive: true });
  writeFileSync(path.join(root, "views", "booking.html"), html);
  return "views/booking.html";
};

describe("the file a published view names", () => {
  let root: string;

  beforeEach(() => {
    root = makeTempDir("mt-public-view-");
  });

  it("is read from the repository root, where app.json is", async () => {
    // `public.view` is declared in `app.json`, which sits at the root, so a
    // path written there is relative to it. Resolving inside a collection's
    // skill folder would ask which collection owns a page belonging to the
    // whole app — a question an app with three of them cannot answer.
    const declared = withView(root, "<div id='grid'></div>");
    const result = await readPublicViewFile(root, { path: declared }, STAMP);
    expect(result.ok).toBe(true);
    expect(result.ok && result.view.html).toContain("<div id='grid'></div>");
  });

  it("refuses a path that names nothing", async () => {
    // The failure it prevents is silent: the page renders, the HTML is empty,
    // and the visitor is told there is nothing here.
    const result = await readPublicViewFile(root, { path: "views/missing.html" }, STAMP);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toContain("could not be opened as a plain file");
  });

  it("refuses to READ through a symlink, even one that stays inside", async () => {
    // The second layer, and the one that survives a race: checking the path
    // and then reading the path resolves it twice, so a process that swaps the
    // validated file for a link in between wins. This link points at a file in
    // the repository — containment has nothing to object to — and the read
    // still refuses, because it goes through a handle opened with O_NOFOLLOW.
    writeFileSync(path.join(root, "inside.html"), "<p>inside</p>");
    mkdirSync(path.join(root, "views"), { recursive: true });
    symlinkSync(path.join(root, "inside.html"), path.join(root, "views", "booking.html"));
    const result = await readPublicViewFile(root, { path: "views/booking.html" }, STAMP);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toContain("without following links");
  });

  it("refuses a page written against the HOST's bridge", async () => {
    // `__MC_VIEW` is the collection pane's contract, where a view holds a
    // capability token and fetches its own data. The public page has neither,
    // so this would publish cleanly and render blank.
    const declared = withView(root, "<script>const t = window.__MC_VIEW.token;</script>");
    const result = await readPublicViewFile(root, { path: declared }, STAMP);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toContain("HOST's custom-view contract");
  });

  it("refuses a page too large to be a Firestore document", async () => {
    // The limit is per DOCUMENT, so what is measured is the document — field
    // names and UTF-8 lengths included. Measuring the file would be measuring
    // the wrong thing, and the answer arrives as a refused write.
    const declared = withView(root, "x".repeat(950_000));
    const result = await readPublicViewFile(root, { path: declared }, STAMP);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toContain("as a Firestore document");
  });

  it("counts the whole document, not just the HTML", () => {
    const bytes = viewDocumentBytes({ html: "abc", publishedAt: STAMP });
    expect(bytes).toBeGreaterThan("abc".length);
  });

  it("refuses a path that climbs out of the repository", async () => {
    // `path.join` normalises `..` away silently, and what is published lands on
    // a document whose rule is `allow read: if true` — so this is not a broken
    // page but somebody's secrets handed to the world.
    writeFileSync(path.join(root, "..", "outside.html"), "<p>secret</p>");
    const result = await readPublicViewFile(root, { path: "views/../../outside.html" }, STAMP);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toContain("resolves outside this repository");
  });

  it("refuses a view that is a symlink out of the repository", async () => {
    // No regex over the declaration can see this one: the path is a perfectly
    // ordinary `views/<name>.html`, and the file system does the leaving.
    //
    // It is refused for being a LINK rather than for where it points, which is
    // the stronger of the two: the check and the read are then about the same
    // object, so swapping the file for a link after validation wins nothing.
    const secret = path.join(root, "..", "secret.html");
    writeFileSync(secret, "<p>secret</p>");
    mkdirSync(path.join(root, "views"), { recursive: true });
    symlinkSync(secret, path.join(root, "views", "leak.html"));
    const result = await readPublicViewFile(root, { path: "views/leak.html" }, STAMP);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toContain("without following links");
  });

  it("refuses, rather than throwing, when the file goes between stat and read", async () => {
    // A delete or a permission change in that window. The gate's contract is
    // problems and no writes; a rejection escaping it would surface as an
    // exception out of publish, which is the one shape callers do not handle.
    const declared = withView(root, "<p>here for now</p>");
    chmodSync(path.join(root, "views", "booking.html"), 0o000);
    const result = await readPublicViewFile(root, { path: declared }, STAMP);
    chmodSync(path.join(root, "views", "booking.html"), 0o644);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toContain("Nothing was written");
  });

  it("refuses a view reached through a symlinked DIRECTORY", async () => {
    // `O_NOFOLLOW` covers the last component only, so the directories on the
    // way have to be checked separately — otherwise a `views/` that is a link
    // to somewhere else is followed silently.
    const elsewhere = makeTempDir("mt-public-view-elsewhere-");
    writeFileSync(path.join(elsewhere, "booking.html"), "<p>not ours</p>");
    symlinkSync(elsewhere, path.join(root, "views"));
    const result = await readPublicViewFile(root, { path: "views/booking.html" }, STAMP);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems.join(" ")).toContain("is a symbolic link");
  });

  it("takes a page that only mentions the PUBLIC bridge", async () => {
    // The neighbouring declaration that must still publish — otherwise the
    // check above is satisfied by refusing everything.
    const declared = withView(root, "<script>window.__MC_PUBLIC_VIEW.ready();</script>");
    const result = await readPublicViewFile(root, { path: declared }, STAMP);
    expect(result.ok).toBe(true);
  });
});

/** The app document as Firestore has it, plus whatever records the test says
 *  the collections hold. */
class LiveDocs implements FirestoreDocs {
  constructor(private readonly items: Record<string, number>) {}
  async list(collectionPath: string): Promise<FirestoreDoc[]> {
    const held = this.items[collectionPath] ?? 0;
    return Array.from({ length: held }, (_unused, index) => ({ id: `row-${index}`, data: {} }));
  }
  async get(): Promise<unknown | null> {
    return null;
  }
  async set(): Promise<void> {}
  async create(): Promise<boolean> {
    return true;
  }
  async delete(): Promise<boolean> {
    return true;
  }
  watch(): () => void {
    return () => {};
  }
}

/** A handle whose listing fails, as a transient permission or network error
 *  does. */
class UnreadableDocs extends LiveDocs {
  constructor() {
    super({});
  }
  override async list(): Promise<FirestoreDoc[]> {
    throw new Error("UNAVAILABLE: the backend is currently unavailable");
  }
}

const handleWith = (items: Record<string, number>) => ({ docs: new LiveDocs(items), email: "me@example.com", uid: "uid-me" });

/** What DEPLOY staged for the collections — the half publish promotes, and the
 *  half this gate must judge (app.json's copy of it is not what goes live). */
const PROMOTED = { slots: { mirrorOf: "bookings" } };
const bookingsPath = `apps/${AID}/collections/bookings/items`;
const slotsPath = `apps/${AID}/collections/slots/items`;

const salon = (overrides: Record<string, unknown> = {}): AuthoredApp =>
  ({
    aid: AID,
    members: { "me@example.com": { "*": "owner" } },
    collections: { slots: { mirrorOf: "bookings" } },
    public: {
      enabled: true,
      read: ["slots"],
      submit: {
        bookings: {
          auth: "verifiedEmail",
          emailField: "customerEmail",
          createFields: ["slot", "customerName", "customerEmail", "status"],
          idFrom: "field",
          idField: "slot",
          idIn: { collection: "slots", where: { field: "state", equals: "open" } },
          mirror: "slots",
        },
      },
    },
    ...overrides,
  }) as AuthoredApp;

/** The app document as it stands after a publish of the declaration above. */
const live = {
  aid: AID,
  collections: { slots: { mirrorOf: "bookings" } },
  public: {
    enabled: true,
    read: ["slots"],
    submit: {
      bookings: {
        auth: "verifiedEmail",
        emailField: "customerEmail",
        createFields: ["slot", "customerName", "customerEmail", "status"],
        idFrom: "field",
        idField: "slot",
        idIn: { collection: "slots", where: { field: "state", equals: "open" } },
        mirror: "slots",
      },
    },
  },
};

describe("the keys that decide which document a submission claims", () => {
  it("lets an unchanged declaration through, records or no records", async () => {
    // First, because every refusal below is only meaningful against a
    // re-publish that must keep working: an app is published again for all
    // sorts of reasons that have nothing to do with its identity keys.
    const problems = await frozenKeyProblems(salon(), PROMOTED, live, handleWith({ [bookingsPath]: 12 }));
    expect(problems).toEqual([]);
  });

  it("lets them move while nothing has been claimed", async () => {
    // An empty collection has no rows whose claim could be stranded, which is
    // exactly the window an author fixes a mistake in.
    const moved = salon({
      public: { ...live.public, submit: { bookings: { ...live.public.submit.bookings, idField: "slotId" } } },
    });
    const problems = await frozenKeyProblems(moved, PROMOTED, live, handleWith({}));
    expect(problems).toEqual([]);
  });

  it("refuses moving the field the id is built from", async () => {
    // Every existing booking would stop holding the slot it was written for —
    // and that slot becomes bookable again by somebody else, while the
    // original booking sits there looking valid.
    const moved = salon({
      public: { ...live.public, submit: { bookings: { ...live.public.submit.bookings, idField: "slotId" } } },
    });
    const problems = await frozenKeyProblems(moved, PROMOTED, live, handleWith({ [bookingsPath]: 3 }));
    expect(problems.join(" ")).toContain("idField: slot → slotId");
    expect(problems.join(" ")).toContain("not something `confirm` overrides");
  });

  it("refuses moving where the claimed record must be found", async () => {
    const moved = salon({
      public: {
        ...live.public,
        submit: { bookings: { ...live.public.submit.bookings, idIn: { collection: "chairs" } } },
      },
    });
    const problems = await frozenKeyProblems(moved, PROMOTED, live, handleWith({ [bookingsPath]: 1 }));
    expect(problems.join(" ")).toContain("idIn:");
  });

  it("refuses dropping the mirror from either side", async () => {
    // Half a mirror is the failure the pair exists to prevent: a staff delete
    // consults the new destination, so the old slot is never returned to
    // `open` and is unsellable for good.
    const withoutMirror = salon({
      public: {
        ...live.public,
        submit: { bookings: { ...live.public.submit.bookings, mirror: undefined } },
      },
    });
    expect((await frozenKeyProblems(withoutMirror, PROMOTED, live, handleWith({ [bookingsPath]: 1 }))).join(" ")).toContain("mirror: slots → (absent)");

    // The collection half comes from what DEPLOY staged, not from app.json.
    expect((await frozenKeyProblems(salon(), { slots: {} }, live, handleWith({ [slotsPath]: 8 }))).join(" ")).toContain("mirrorOf: bookings → (absent)");
  });

  it("reads a reordered declaration as the same declaration", async () => {
    // `idIn` is compared as text, and JSON.stringify keeps INSERTION order — so
    // without canonicalising, tidying the keys in `app.json` would read as a
    // moved identity key and refuse a re-publish that changes nothing.
    const reordered = salon({
      public: {
        ...live.public,
        submit: {
          bookings: {
            ...live.public.submit.bookings,
            idIn: { where: { equals: "open", field: "state" }, collection: "slots" },
          },
        },
      },
    });
    const problems = await frozenKeyProblems(reordered, PROMOTED, live, handleWith({ [bookingsPath]: 5 }));
    expect(problems).toEqual([]);
  });

  it("judges the STAGED mirror, not the one in app.json", async () => {
    // Deploy a changed mirror, revert the key locally, publish: the manifest
    // agrees with the live document while the promotion does not, so a gate
    // reading app.json would see nothing at all.
    const problems = await frozenKeyProblems(salon(), { slots: { mirrorOf: "somewhere-else" } }, live, handleWith({ [slotsPath]: 2 }));
    expect(problems.join(" ")).toContain("mirrorOf: bookings → somewhere-else");
  });

  it("refuses when it cannot tell whether anything is held", async () => {
    // A failed listing is not an empty collection. Treating it as one lets a
    // changed identity key through on a transient error and strands every
    // existing claim — and the migration scan cannot cover for it, being a
    // separate read that may have succeeded a moment earlier.
    const moved = salon({
      public: { ...live.public, submit: { bookings: { ...live.public.submit.bookings, idField: "slotId" } } },
    });
    const problems = await frozenKeyProblems(moved, PROMOTED, live, { docs: new UnreadableDocs(), email: "me@example.com", uid: "uid-me" });
    expect(problems.join(" ")).toContain("could not be read");
    expect(problems.join(" ")).toContain("not something `confirm` overrides");
  });

  it("refuses a mirror WITHDRAWN with its collection", async () => {
    // Deploy drops the staging document of a collection the repository no
    // longer has, so the promoted map omits it entirely — and a gate that
    // walked only the promoted keys would never notice the live half it is
    // about to drop, which is the invariant it exists to hold.
    const problems = await frozenKeyProblems(salon(), {}, live, handleWith({ [slotsPath]: 4 }));
    expect(problems.join(" ")).toContain("mirrorOf: bookings → (absent)");
  });

  it("says nothing about a FIRST publish", async () => {
    // There is no live declaration to have moved away from, and the app
    // document does not exist yet.
    const problems = await frozenKeyProblems(salon(), PROMOTED, null, handleWith({}));
    expect(problems).toEqual([]);
  });
});
