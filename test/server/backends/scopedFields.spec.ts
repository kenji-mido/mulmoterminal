// @vitest-environment node
//
// Three keys in `app.json` name a FIELD the deployed rules read at write time.
// A name that misses, or a field of a type the rules cannot compare, does not
// weaken the app — it denies every write it governs, silently, for everybody.
// So each case below states the refusal AND the neighbouring declaration that
// must still pass.
import { describe, it, expect } from "vitest";
import { parseAuthoredApp } from "@mulmoclaude/core/collection/server";
import type { CollectionSchema } from "@mulmoclaude/core/collection";
import { scopedFieldProblems, stagedScopeProblems } from "../../../server/backends/sharedApp/scopedFields.js";

const bookings: CollectionSchema = {
  title: "Bookings",
  icon: "event",
  primaryKey: "id",
  storage: { type: "firestore" },
  fields: {
    id: { type: "string", label: "ID", primary: true, required: true },
    stylistEmail: { type: "email", label: "担当" },
    stylist: { type: "ref", label: "担当（表示）", to: "stylists" },
    classId: { type: "string", label: "クラス" },
    createdAt: { type: "datetime", label: "申込日時" },
    note: { type: "string", label: "メモ" },
  },
};

const classes: CollectionSchema = {
  title: "Classes",
  icon: "fitness_center",
  primaryKey: "id",
  storage: { type: "firestore" },
  fields: {
    id: { type: "string", label: "ID", primary: true, required: true },
    opensAt: { type: "number", label: "解禁（epoch millis）" },
    startsAt: { type: "datetime", label: "開始" },
  },
};

const SCHEMAS = [
  { cid: "bookings", schema: bookings },
  { cid: "classes", schema: classes },
];

const app = (body: Record<string, unknown>) => {
  const parsed = parseAuthoredApp(JSON.stringify({ aid: "a1", members: { "o@e.com": { "*": "owner" } }, ...body }));
  if (!parsed.ok) throw new Error(parsed.problems.join("; "));
  return parsed.app;
};

const problemsFor = (body: Record<string, unknown>) => scopedFieldProblems(app(body), SCHEMAS);

describe("assigneeField — whose row is this", () => {
  it("accepts a field that holds an address", () => {
    expect(problemsFor({ collections: { bookings: { assigneeField: "stylistEmail" } } })).toEqual([]);
  });

  it("refuses a name the collection does not declare", () => {
    const problems = problemsFor({ collections: { bookings: { assigneeField: "stylist_email" } } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("'stylist_email'");
    expect(problems[0]).toContain("nobody else notices");
  });

  it("refuses a ref, which stores a primary key and not an address", () => {
    // The trap this exists for: `stylist` is the natural-looking answer, it
    // renders correctly in the UI, and it can never equal a signed-in address.
    const problems = problemsFor({ collections: { bookings: { assigneeField: "stylist" } } });
    expect(problems[0]).toContain("has to hold an email ADDRESS");
  });
});

describe("stampField — when did this reach the queue", () => {
  const submit = (extra: Record<string, unknown>) => ({
    public: {
      enabled: true,
      submit: { bookings: { auth: "verifiedEmail", createFields: ["classId", "createdAt"], ...extra } },
    },
  });

  it("accepts a datetime field", () => {
    expect(problemsFor(submit({ stampField: "createdAt" }))).toEqual([]);
  });

  it("refuses a name the collection does not declare", () => {
    const problems = problemsFor(submit({ stampField: "submittedAt" }));
    expect(problems[0]).toContain("nothing can be submitted at all");
  });

  it("refuses a field the rules cannot write a timestamp into", () => {
    const problems = problemsFor(submit({ stampField: "note" }));
    expect(problems[0]).toContain("declare it as `datetime`");
  });
});

describe("window.fromField — when does this one open", () => {
  const withWindow = (fromField: Record<string, string>) => ({
    public: {
      enabled: true,
      submit: { bookings: { auth: "verifiedEmail", createFields: ["classId"], window: { fromField } } },
    },
  });

  it("accepts a ref into a collection that carries epoch millis", () => {
    expect(problemsFor(withWindow({ ref: "classId", collection: "classes", field: "opensAt" }))).toEqual([]);
  });

  it("refuses a bound the target does not carry", () => {
    const problems = problemsFor(withWindow({ ref: "classId", collection: "classes", field: "opens" }));
    expect(problems[0]).toContain("the window never opens for any of them");
  });

  it("refuses a datetime bound, which the rules cannot compare with a clock", () => {
    // `request.time.toMillis()` is a number. Comparing it with a Timestamp is
    // a type error, and a rules type error denies — so the app would look
    // right and take no submissions at all.
    const problems = problemsFor(withWindow({ ref: "classId", collection: "classes", field: "startsAt" }));
    expect(problems[0]).toContain("must be a 'number' holding EPOCH");
  });

  it("says nothing about an unknown target collection, which core already refuses", () => {
    // One mistake must read as one problem. `windowRefProblems` in core names
    // the unknown collection; repeating it here would make the author look for
    // two.
    expect(problemsFor(withWindow({ ref: "classId", collection: "sessions", field: "opensAt" }))).toEqual([]);
  });

  it("refuses a ref field the collection does not declare", () => {
    const problems = problemsFor(withWindow({ ref: "lessonId", collection: "classes", field: "opensAt" }));
    expect(problems[0]).toContain("without it nothing opens");
  });
});

describe("a declaration that names none of them", () => {
  it("is left alone", () => {
    expect(problemsFor({ collections: { bookings: { statusField: "status" } } })).toEqual([]);
  });
});

// --- what publish actually promotes ----------------------------------------
//
// publish writes a PAIR: the rule configuration and schemas deploy staged, and
// the roster the manifest carries now. A check that only reads the manifest
// sees two keys sitting side by side and agreeing, and passes — while what
// lands is the staged half beside the new roster.

const STYLIST = "anna@salon.jp";

const stagedEntry = (cid: string, schema: CollectionSchema, config?: Record<string, unknown>) => ({
  cid,
  doc: { publishedSchema: schema, deployedAt: 1, deployedBy: "o@e.com", ...(config === undefined ? {} : { config }) },
});

describe("the staged configuration, paired with the roster being published", () => {
  const roster = { "o@e.com": { "*": "owner" }, [STYLIST]: { bookings: "assignee" } };

  it("passes when the deploy carried the field", () => {
    const declared = app({ members: roster, collections: { bookings: { assigneeField: "stylistEmail" } } });
    expect(stagedScopeProblems(declared, [stagedEntry("bookings", bookings, { assigneeField: "stylistEmail" })] as never)).toEqual([]);
  });

  it("refuses a role added to app.json after the deploy that would have carried its field", () => {
    // deploy A (no assigneeField) → edit B (add the field AND the member) →
    // publish. The manifest is internally sound, so core's check passes; the
    // promoted configuration is A's, so the stylist would be refused every
    // write and nothing anywhere would say why.
    const declared = app({ members: roster, collections: { bookings: { assigneeField: "stylistEmail" } } });
    const problems = stagedScopeProblems(declared, [stagedEntry("bookings", bookings, {})] as never);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("carries no assigneeField");
    expect(problems[0]).toContain("Run deploy again");
  });

  it("refuses a field the staged SCHEMA does not have, however current the tree is", () => {
    // The mirror of the same drift: the field name is right in the repository
    // and absent from the version being promoted.
    const declared = app({ members: roster, collections: { bookings: { assigneeField: "stylistEmail" } } });
    const stale: CollectionSchema = { ...bookings, fields: { id: { type: "string", label: "ID", primary: true, required: true } } };
    const problems = stagedScopeProblems(declared, [stagedEntry("bookings", stale, { assigneeField: "stylistEmail" })] as never);
    expect(problems[0]).toContain("the staged version of 'bookings'");
    expect(problems[0]).toContain("Run deploy again");
  });

  it("says nothing about a member whose collection is not staged at all", () => {
    // That is the staged-set gate's refusal ("not staged, so there is no
    // reviewed version to promote"), and it names every missing collection at
    // once. Repeating it per member would bury it.
    const declared = app({ members: roster, collections: { bookings: { assigneeField: "stylistEmail" } } });
    expect(stagedScopeProblems(declared, [stagedEntry("classes", classes, {})] as never)).toEqual([]);
  });

  it("checks the stamped field against the staged schema too", () => {
    const declared = app({
      public: { enabled: true, submit: { bookings: { auth: "verifiedEmail", createFields: ["createdAt"], stampField: "createdAt" } } },
    });
    const stale: CollectionSchema = { ...bookings, fields: { id: { type: "string", label: "ID", primary: true, required: true } } };
    const problems = stagedScopeProblems(declared, [stagedEntry("bookings", stale, {})] as never);
    expect(problems[0]).toContain("stampField names 'createdAt'");
    expect(problems[0]).toContain("Run deploy again");
  });
});
