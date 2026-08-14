// Reading back what deploy staged.
//
// The staged documents are the thing publish promotes — NOT the working tree. That is the whole
// point of the split: what the roster tested through `/staging/{aid}` is exactly what ships, where
// re-projecting from disk would publish whatever the tree says at publish time, which nobody has
// looked at.
//
// They come back from Firestore as `unknown`, and they are documents a previous version of this
// code (or a hand edit) could have written, so they are checked rather than asserted.
import { isRecord } from "../../../common/isRecord.js";
import { appStagingPath, type StagedSchemaDoc } from "@mulmoclaude/core/collection/server";
import type { SharedAppHandle } from "./context.js";

/** A checked narrowing rather than an assertion: these documents come back from Firestore as
 *  `unknown`, and a hand edit or an older version of this code could have written anything.
 *
 *  The provenance keys are part of the check, not decoration. A staged document always carries
 *  them (deploy writes them in the same projection as the schema), so one that does not is not a
 *  document this code wrote — and promoting it would publish a schema nobody can attribute. */
function isStagedDoc(value: unknown): value is StagedSchemaDoc {
  return isRecord(value) && isRecord(value.publishedSchema) && typeof value.deployedAt === "number" && typeof value.deployedBy === "string";
}

export interface StagedEntry {
  cid: string;
  doc: StagedSchemaDoc;
}

/** Everything under `apps/{aid}/staging`, in document-id order, or the reason it could not be
 *  read. A document missing `publishedSchema` is reported rather than skipped: silently dropping
 *  it would publish an app with one collection fewer than the roster reviewed. */
export async function readStaged(handle: SharedAppHandle, aid: string): Promise<{ ok: true; staged: StagedEntry[] } | { ok: false; problems: string[] }> {
  let docs;
  try {
    docs = await handle.docs.list(appStagingPath(aid));
  } catch (err) {
    return {
      ok: false,
      problems: [`cannot read the staged schemas (apps/${aid}/staging): ${err instanceof Error ? err.message : String(err)}`, "Nothing was written."],
    };
  }
  const staged: StagedEntry[] = [];
  const problems: string[] = [];
  for (const doc of docs) {
    if (isStagedDoc(doc.data)) {
      staged.push({ cid: doc.id, doc: doc.data });
      continue;
    }
    problems.push(
      `apps/${aid}/staging/${doc.id} is not a staged schema — it carries no publishedSchema, or no record of the deploy that wrote it — ` +
        `so there is nothing to promote for '${doc.id}'. Run deploy again.`,
    );
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, staged };
}
