// Shared pagination for the remote-host collection handler.
//
// The command channel writes the result INSIDE the command document, and
// Firestore caps a document at 1 MiB. offset/limit slice the records; limit is
// clamped to [1, MAX_PAGE_LIMIT] (default 50) so a runaway page can't blow that
// budget. The clamps live in @mulmoclaude/core/remote-view (params arrive as
// untyped JSON there too) so this matches MulmoClaude's identical page semantics.
import { clampLimit, clampOffset } from "@mulmoclaude/core/remote-view";
import { deriveAll, type DerivableFieldSpec, type DerivableRecord } from "@mulmoclaude/core/collection";
import type { JsonObject } from "@mulmoclaude/core/remote-host";
import { jsonPayload } from "./jsonPayload.js";
import { isRecord } from "../../../common/isRecord.js";

export { clampLimit, clampOffset };

/** Resolve record-local computed fields (derived formulas) before paging, so the
 *  phone sees the same numbers the desktop renders. There is no ref cache over
 *  the channel, so formulas that dereference `ref` fields stay absent (parity
 *  with MulmoClaude's channel path). */
export const deriveItems = (schema: { fields?: Record<string, DerivableFieldSpec> }, items: unknown[]): DerivableRecord[] =>
  items.flatMap((item) => (isRecord(item) ? [deriveAll({ fields: schema.fields ?? {} }, item, {})] : []));

/** Build the paginated result.
 *
 *  Converted rather than asserted (see jsonPayload.ts): `detail` and `items` arrive as `unknown`,
 *  and `CollectionDetail` reaches `schema.spawn.set`, typed `Record<string, unknown>` — so the
 *  payload cannot be PROVEN JSON by the type system even though the schema loader only ever puts
 *  JSON there. The walk makes it so instead of claiming it. */
export const pageResult = (detail: unknown, items: unknown[], offset: number, limit: number): JsonObject =>
  jsonPayload({ collection: detail, items: items.slice(offset, offset + limit), total: items.length, offset, limit });
