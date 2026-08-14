// The declaration's field names, checked against the schemas they name — and
// then checked AGAIN, at publish, against what publish will actually promote.
//
// Three keys in `app.json` point at a FIELD rather than declaring one, and all
// three are read by the deployed rules at write time:
//
//   `collections.<cid>.assigneeField`     — whose row is this
//   `public.submit.<cid>.stampField`      — when did this reach the queue
//   `public.submit.<cid>.window.fromField` — when does this one open
//
// A name that misses, or a field of the wrong type, is not a weaker app. The
// rules read the value, find nothing or find something they cannot compare,
// and DENY — every time, for everybody, with no message. So the check belongs
// where the author is still holding the declaration.
//
// It lives in MulmoTerminal rather than in core's `publishChecks` because it
// needs the schemas, and `PublishableCollection` deliberately carries only a
// cid and a primary key. `publicInputProblems` in ./publicForm.ts is the same
// split for the same reason — and the same TWO-VERSION shape, for the reason
// below.
//
// WHY TWICE. Publish does not publish the working tree. It promotes what deploy
// staged (`staging/{cid}`, carrying both the schema and that collection's rule
// configuration) while writing the roster from the MANIFEST. So the app that
// ends up deployed is a PAIR: a staged configuration and a current roster, and
// nobody has ever checked that pair. Deploy without `assigneeField`, then add
// the field and the member to `app.json` and publish, and every check passes on
// a declaration that is internally sound — while what lands is an assignee with
// no field to compare, which is the exact fail-closed trap these checks exist
// to prevent.
import type { CollectionFieldType, CollectionSchema } from "@mulmoclaude/core/collection";
import { promotedRoleProblems, type AuthoredApp } from "@mulmoclaude/core/collection/server";
import type { StagedEntry } from "./staged.js";

/** What a member's address can be compared against.
 *
 *  The rules compare the field's value with `request.auth.token.email`, so it
 *  holds an ADDRESS. Notably NOT `ref`: a ref stores the target record's
 *  primary-key slug, and a roster is keyed by address — the two match only if
 *  the staff collection happens to be keyed by email, which is not something
 *  this check can know or should assume. */
const ADDRESS_TYPES: ReadonlySet<CollectionFieldType> = new Set<CollectionFieldType>(["string", "email"]);

/** What the document id of a window's target can be read out of. */
const REF_TYPES: ReadonlySet<CollectionFieldType> = new Set<CollectionFieldType>(["string", "ref"]);

/** Which version a check is reading, because the fix differs: against the tree
 *  the declaration is wrong, against the staged copy the declaration may be
 *  right and simply never deployed. */
type Version = "tree" | "staged";

/** The one sentence that turns "this is wrong" into "this is out of step". */
const REDEPLOY = "Run deploy again, so the version being published is the one the declaration describes.";
const tail = (version: Version) => (version === "staged" ? ` ${REDEPLOY}` : "");

interface Sources {
  /** `collections[cid]`, as this version of the app carries it. */
  assigneeFieldOf: (cid: string) => string | undefined;
  schemaOf: (cid: string) => CollectionSchema | undefined;
  /** The cids this version knows about, for the roster pairing. */
  cids: readonly string[];
}

/** Against the working tree: what the author is holding right now. */
export function scopedFieldProblems(app: AuthoredApp, schemas: readonly { cid: string; schema: CollectionSchema }[]): string[] {
  const byCid = new Map(schemas.map((entry) => [entry.cid, entry.schema]));
  return fieldProblems(
    app,
    {
      assigneeFieldOf: (cid) => app.collections?.[cid]?.assigneeField,
      schemaOf: (cid) => byCid.get(cid),
      cids: Object.keys(app.collections ?? {}),
    },
    "tree",
  );
}

/** Against what publish will promote: the STAGED configuration and schemas,
 *  paired with the roster the manifest carries now. */
export function stagedScopeProblems(app: AuthoredApp, staged: readonly StagedEntry[]): string[] {
  const configs = new Map(staged.map((entry) => [entry.cid, entry.doc.config]));
  const schemas = new Map(staged.map((entry) => [entry.cid, entry.doc.publishedSchema]));
  const sources: Sources = {
    assigneeFieldOf: (cid) => configs.get(cid)?.assigneeField,
    schemaOf: (cid) => schemas.get(cid),
    cids: [...configs.keys()],
  };
  // The roster pairing itself is core's `promotedRoleProblems`: it checks the
  // value `stagedRuleConfig` produces, which is literally what publish writes.
  // What is left here is the half core cannot do — the SCHEMAS those names have
  // to exist in, which its publish surface deliberately does not carry.
  return [...promotedRoleProblems(app, [...staged]), ...fieldProblems(app, sources, "staged")];
}

function fieldProblems(app: AuthoredApp, sources: Sources, version: Version): string[] {
  return [...assigneeFieldProblems(sources, version), ...stampFieldProblems(app, sources, version), ...windowFieldProblems(app, sources, version)];
}

/** The field that says whose row it is. */
function assigneeFieldProblems(sources: Sources, version: Version): string[] {
  return sources.cids.flatMap((cid) => {
    const name = sources.assigneeFieldOf(cid);
    const schema = sources.schemaOf(cid);
    if (name === undefined || schema === undefined) return [];
    const spec = fieldOf(schema, name);
    if (spec === undefined) {
      return [
        `collections.${cid}.assigneeField names '${name}', which ${describe(cid, version)} does not declare. The rules compare that field with the signed-in address ` +
          `to decide whose row it is, so every write by an assignee is refused — and nobody else notices.${tail(version)}`,
      ];
    }
    if (ADDRESS_TYPES.has(spec.type)) return [];
    return [
      `collections.${cid}.assigneeField names '${name}', which is a '${spec.type}' field${version === "staged" ? " in the staged schema" : ""}. It has to hold an ` +
        `email ADDRESS, because that is the only thing the rules can compare a member against. A ref stores the target's primary key, not an address — declare a ` +
        `plain string or email field beside it and let the ref stay the thing the UI renders.${tail(version)}`,
    ];
  });
}

/** The field pinned to the server clock. */
function stampFieldProblems(app: AuthoredApp, sources: Sources, version: Version): string[] {
  return Object.entries(app.public?.submit ?? {}).flatMap(([cid, submit]) => {
    const name = submit.stampField;
    const schema = sources.schemaOf(cid);
    if (name === undefined || schema === undefined) return [];
    const spec = fieldOf(schema, name);
    if (spec === undefined) {
      return [
        `public.submit.${cid}.stampField names '${name}', which ${describe(cid, version)} does not declare. The rules require the record to CARRY the server time ` +
          `in that field, so nothing can be submitted at all.${tail(version)}`,
      ];
    }
    if (spec.type === "datetime") return [];
    return [
      `public.submit.${cid}.stampField names '${name}', which is a '${spec.type}' field${version === "staged" ? " in the staged schema" : ""}. What the rules write ` +
        `there is \`request.time\`, a timestamp — declare it as \`datetime\`, or the comparison is a type error and every submission is denied.${tail(version)}`,
    ];
  });
}

/** The bound that lives on another record. */
function windowFieldProblems(app: AuthoredApp, sources: Sources, version: Version): string[] {
  return Object.entries(app.public?.submit ?? {}).flatMap(([cid, submit]) => {
    const ref = submit.window?.fromField;
    const schema = sources.schemaOf(cid);
    if (ref === undefined || schema === undefined) return [];
    const problems: string[] = [];
    const refSpec = fieldOf(schema, ref.ref);
    if (refSpec === undefined) {
      problems.push(
        `public.submit.${cid}.window.fromField.ref names '${ref.ref}', which ${describe(cid, version)} does not declare. That field is where the rules read WHICH ` +
          `record carries the opening time, so without it nothing opens.${tail(version)}`,
      );
    } else if (!REF_TYPES.has(refSpec.type)) {
      problems.push(
        `public.submit.${cid}.window.fromField.ref names '${ref.ref}', a '${refSpec.type}' field. The rules build a document id out of its value, so it has to be a ` +
          `string or a ref.${tail(version)}`,
      );
    }
    const target = sources.schemaOf(ref.collection);
    // An unknown target collection is core's refusal (`windowRefProblems`);
    // saying it twice would make one mistake read as two.
    if (target === undefined) return problems;
    const opens = fieldOf(target, ref.field);
    if (opens === undefined) {
      problems.push(
        `public.submit.${cid}.window.fromField.field names '${ref.field}', which ${describe(ref.collection, version)} does not declare. Each record there has to ` +
          `carry its own opening time, or the window never opens for any of them.${tail(version)}`,
      );
    } else if (opens.type !== "number") {
      problems.push(
        `public.submit.${cid}.window.fromField.field names '${ref.field}', which is a '${opens.type}' field in '${ref.collection}'. It must be a 'number' holding ` +
          `EPOCH MILLIS: the rules compare it with \`request.time.toMillis()\`, and comparing that with anything else is a type error that denies every submission. ` +
          `Whoever schedules the record computes the value ("three days before, at 08:00" is business knowledge, and the rules have no usable date arithmetic).` +
          tail(version),
      );
    }
    return problems;
  });
}

const describe = (cid: string, version: Version) => (version === "staged" ? `the staged version of '${cid}' — the one publish promotes —` : `'${cid}'`);

/** Own-property guarded: a declaration naming `toString` must MISS here rather
 *  than read an Object.prototype member and pass as a declared field. */
function fieldOf(schema: CollectionSchema, name: string) {
  return Object.hasOwn(schema.fields, name) ? schema.fields[name] : undefined;
}
