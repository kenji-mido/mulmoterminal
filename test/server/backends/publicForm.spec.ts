// @vitest-environment node
//
// The public page cannot read the schema — `schemaRead` is `readerOf || publicRead || partRead`,
// and the person answering a survey is none of those. So what it CAN read has to be enough to draw
// the form, and this is the projection that makes it so.
import { describe, it, expect } from "vitest";
import { parseAuthoredApp } from "@mulmoclaude/core/collection/server";
import { oversizeProblem, publicFormOf, publicInputProblems, schemasOfCollections } from "../../../server/backends/sharedApp/publicForm.js";

const schema = {
  title: "Responses",
  icon: "reviews",
  primaryKey: "id",
  storage: { type: "firestore" as const },
  fields: {
    id: { type: "string" as const, label: "ID", primary: true, required: true },
    name: { type: "string" as const, label: "お名前" },
    score: { type: "enum" as const, label: "満足度", values: ["1", "2", "3", "4", "5"] },
    comment: { type: "text" as const, label: "ご感想" },
    status: { type: "string" as const, label: "状態" },
  },
};

// `config` is the STAGED rule configuration — what publish promotes onto the app document and
// what the rules then check a public create against. The form's `statusField` has to come from
// here rather than from `app.json`, or an edit between deploy and publish moves one and not the
// other.
const stagedResponses = {
  cid: "responses",
  doc: { publishedSchema: schema, config: { submitOnly: true, statusField: "status" }, deployedAt: 1, deployedBy: "o@e.com" },
};

const staged = [stagedResponses];

const authored = (submit: Record<string, unknown>) => {
  const parsed = parseAuthoredApp(
    JSON.stringify({
      aid: "a1",
      members: { "o@e.com": { "*": "owner" } },
      collections: { responses: { submitOnly: true, statusField: "status" } },
      public: { enabled: true, read: [], submit },
    }),
  );
  if (!parsed.ok) throw new Error(parsed.problems.join("; "));
  return parsed.app;
};

const surveySubmit = {
  responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name", "score", "comment"] },
};

describe("publicFormOf", () => {
  it("gives the page a label, a type and an enum's choices", () => {
    expect(publicFormOf(authored(surveySubmit), staged)).toEqual({
      responses: {
        fields: {
          name: { label: "お名前", type: "string" },
          score: { label: "満足度", type: "enum", values: ["1", "2", "3", "4", "5"] },
          comment: { label: "ご感想", type: "text" },
        },
        // Not `status`, and not guessable: the create rule requires the initial value to land in
        // the field `collections[cid].statusField` names, and core's config projection does not
        // carry it. A page that assumed the name would be refused.
        statusField: "status",
      },
    });
  });

  it("publishes only what the visitor may write", () => {
    // `createFields` is the rules' whitelist for a public create, so a field outside it cannot be
    // submitted — and publishing its label would put the app's internal vocabulary on a
    // world-readable document for nobody's benefit.
    const form = publicFormOf(authored(surveySubmit), staged);
    expect(Object.keys(form.responses?.fields ?? {})).not.toContain("status");
    expect(Object.keys(form.responses?.fields ?? {})).not.toContain("id");
  });

  it("marks a field the rules will insist on — from either declaration", async () => {
    // Two places can insist and the page has to honour both: the schema's own `required`, and
    // `public.submit[cid].validate.required`, which is what the deployed rules check on a public
    // create. Dropped, the visitor meets it as a permission error naming no field.
    const withRequired = {
      ...schema,
      fields: { ...schema.fields, name: { type: "string" as const, label: "お名前", required: true } },
    };
    const form = publicFormOf(
      authored({ responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name", "score", "comment"], validate: { required: ["score"] } } }),
      [{ cid: "responses", doc: { publishedSchema: withRequired, deployedAt: 1, deployedBy: "o@e.com" } }],
    );
    expect(form.responses?.fields.name).toMatchObject({ required: true });
    expect(form.responses?.fields.score).toMatchObject({ required: true });
    // And nothing is marked that neither declaration asked for.
    expect(form.responses?.fields.comment).not.toHaveProperty("required");
  });

  it("names the status field the rules will check, whatever it is called", async () => {
    // `status` is a convention, not a rule. The create rule reads `collections[cid].statusField`,
    // so a collection that calls it `state` refuses a submission that writes `status` — and the
    // visitor cannot learn the name from anywhere else.
    //
    // Staged and manifest deliberately DISAGREE here: publish promotes the staged copy, so that
    // is the one the page must be told about.
    const parsed = parseAuthoredApp(
      JSON.stringify({
        aid: "a1",
        members: { "o@e.com": { "*": "owner" } },
        collections: { responses: { submitOnly: true, statusField: "state" } },
        public: {
          enabled: true,
          read: [],
          submit: { responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name"], initialStatus: "submitted" } },
        },
      }),
    );
    if (!parsed.ok) throw new Error(parsed.problems.join("; "));
    expect(publicFormOf(parsed.app, staged).responses?.statusField).toBe("status");
  });

  it("says nothing about a collection the app does not open", () => {
    expect(publicFormOf(authored({}), staged)).toEqual({});
  });

  it("skips a submit whose collection is not staged, rather than publishing an empty form", () => {
    // An empty entry reads as a form that failed to load; absence is a fact the page can state.
    expect(publicFormOf(authored({ waitlist: { auth: "verifiedEmail", emailField: "email", createFields: ["name"] } }), staged)).toEqual({});
  });

  it("ignores a createFields entry the schema does not declare", () => {
    // Including `toString`: an own-property guard is what keeps an Object.prototype member from
    // being published as a field nobody wrote.
    const form = publicFormOf(authored({ responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name", "toString", "nope"] } }), staged);
    expect(form.responses?.fields).toEqual({ name: { label: "お名前", type: "string" } });
  });
});

describe("the field the page stamps rather than asks", () => {
  // `stampField` is in `createFields` because the rules refuse any key outside
  // that list — not because a visitor answers it. Drawing it would invite an
  // answer the rules then deny, and omitting it from the form entirely would
  // leave the page with no way to learn the name.
  const stamped = authored({
    responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name", "createdAt"], stampField: "createdAt" },
  });
  const withStamp = [
    {
      ...stagedResponses,
      doc: {
        ...stagedResponses.doc,
        publishedSchema: { ...schema, fields: { ...schema.fields, createdAt: { type: "datetime" as const, label: "受付日時" } } },
      },
    },
  ];

  it("is named on the form and not drawn as an input", () => {
    const form = publicFormOf(stamped, withStamp);
    expect(form.responses?.stampField).toBe("createdAt");
    expect(Object.keys(form.responses?.fields ?? {})).toEqual(["name"]);
  });

  it("keeps a form whose only create field is the stamp", () => {
    // "Count me in": `idFrom: "auth.uid"` plus a server timestamp is a complete
    // submission — the identity of whoever pressed the button and the moment
    // they did. It draws no inputs, and it is still a form: without an entry the
    // page has no submit target and no way to learn the field the rules insist
    // on, for a declaration core accepts.
    const oneClick = authored({
      responses: { auth: "verifiedEmail", idFrom: "auth.uid", createFields: ["createdAt"], stampField: "createdAt" },
    });
    const form = publicFormOf(oneClick, withStamp);
    // `statusField` rides along as it does for any collection whose staged
    // configuration names one — the page needs it whether or not it draws
    // anything.
    expect(form.responses).toEqual({ fields: {}, stampField: "createdAt", statusField: "status" });
  });

  it("still drops a collection that draws nothing and stamps nothing", () => {
    // The guard this sits beside is not weakened: an empty entry with nothing
    // behind it reads as a form that failed to load.
    expect(publicFormOf(authored({ responses: { auth: "verifiedEmail", createFields: ["nope"] } }), staged).responses).toBeUndefined();
  });

  it("is absent when nothing is stamped", () => {
    expect(publicFormOf(authored(surveySubmit), staged).responses?.stampField).toBeUndefined();
  });
});

describe("fields a stranger cannot be asked for", () => {
  // `createFields` is not only what the page draws from — it is the whitelist the deployed rules
  // judge a public create by. So a computed field left in it is a value from the internet landing
  // in a field the host is supposed to compute; dropping it from the form alone would not stop it.
  const withField = (name: string, spec: Record<string, unknown>) => [
    { ...stagedResponses, doc: { ...stagedResponses.doc, publishedSchema: { ...schema, fields: { ...schema.fields, [name]: spec } } } },
  ];

  it("does not draw a computed field", () => {
    const app = authored({ responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name", "flagged"] } });
    const form = publicFormOf(app, withField("flagged", { type: "flag", label: "要対応", where: { field: "score", in: ["1"] } }));
    expect(Object.keys(form.responses?.fields ?? {})).toEqual(["name"]);
  });

  it("does not draw a field it cannot describe", () => {
    const app = authored({ responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name", "owner"] } });
    const form = publicFormOf(app, withField("owner", { type: "ref", label: "担当", to: "people" }));
    expect(Object.keys(form.responses?.fields ?? {})).toEqual(["name"]);
  });
});

describe("oversizeProblem", () => {
  it("says nothing about a form that fits", () => {
    expect(oversizeProblem({ form: publicFormOf(authored(surveySubmit), staged) })).toBeNull();
  });

  it("stops a form too big for the one document a visitor may read", () => {
    const values = Array.from({ length: 80000 }, (_, index) => `choice-${index}`);
    const problem = oversizeProblem({ form: { responses: { fields: { score: { label: "満足度", type: "enum", values } } } } });
    expect(problem).toContain("one Firestore document");
  });
});

describe("publicInputProblems", () => {
  // The gate that runs before any write — `declarationProblems`, shared by deploy, publish and
  // check — so the author is told while it is still a declaration.
  const collection = (fields: Record<string, unknown>) =>
    schemasOfCollections([{ slug: "responses", schema: { ...schema, fields: { ...schema.fields, ...fields } } } as never]);

  it("says nothing about a form of plain fields", () => {
    expect(publicInputProblems(authored(surveySubmit), collection({}))).toEqual([]);
  });

  it("refuses a computed field, naming it and saying what to do", () => {
    const app = authored({ responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name", "flagged"] } });
    const problems = publicInputProblems(app, collection({ flagged: { type: "flag", label: "要対応", where: { field: "score", in: ["1"] } } }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("'flagged'");
    expect(problems[0]).toContain("computed by the host");
  });

  it("refuses a field the public page cannot draw", () => {
    const app = authored({ responses: { auth: "verifiedEmail", emailField: "email", createFields: ["owner"] } });
    const problems = publicInputProblems(app, collection({ owner: { type: "ref", label: "担当", to: "people" } }));
    expect(problems[0]).toContain("cannot draw one");
  });

  it("leaves a collection it has no schema for to the checks that own that", () => {
    const app = authored({ ghost: { auth: "verifiedEmail", emailField: "email", createFields: ["name"] } });
    expect(publicInputProblems(app, collection({}))).toEqual([]);
  });
});

describe("the status field the page writes", () => {
  // publish promotes `collections[cid]` from `staging/{cid}` so a manifest edit after deploy
  // cannot change the rule behaviour being published. The form has to read the same staged copy:
  // otherwise deploy with `state`, edit `app.json` to `status`, publish — and the page writes a
  // key the promoted rule refuses, with nothing on the page to say why.
  it("comes from what was staged, not from app.json", () => {
    const app = authored(surveySubmit);
    const restaged = [{ ...stagedResponses, doc: { ...stagedResponses.doc, config: { submitOnly: true, statusField: "state" } } }];
    expect(publicFormOf(app, restaged).responses?.statusField).toBe("state");
  });

  it("is absent when the staged configuration names none", () => {
    const restaged = [{ ...stagedResponses, doc: { ...stagedResponses.doc, config: { submitOnly: true } } }];
    expect(publicFormOf(authored(surveySubmit), restaged).responses?.statusField).toBeUndefined();
  });
});

describe("a declaration that has moved on since the deploy", () => {
  // The deploy gate reads the working tree; publish promotes the STAGED schemas. Add a field to
  // both the schema and `createFields` without deploying again, and the rules being published
  // would demand a field the published form cannot draw — a visitor filling the form in correctly
  // is refused, with nothing to fix.
  const app = authored({ responses: { auth: "verifiedEmail", emailField: "email", createFields: ["name", "referrer"] } });

  it("passes against the tree that has the field", () => {
    const withNew = { ...schema, fields: { ...schema.fields, referrer: { type: "string" as const, label: "きっかけ" } } };
    expect(publicInputProblems(app, [{ cid: "responses", schema: withNew }])).toEqual([]);
  });

  it("is refused against the staged version that does not, and says to deploy again", () => {
    const problems = publicInputProblems(app, [{ cid: "responses", schema }], "staged");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("'referrer'");
    expect(problems[0]).toContain("Run deploy again");
  });

  it("calls an undeclared name a name, against the tree", () => {
    const problems = publicInputProblems(app, [{ cid: "responses", schema }]);
    expect(problems[0]).toContain("does not declare a field called 'referrer'");
  });
});
