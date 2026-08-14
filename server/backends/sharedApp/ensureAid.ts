// The `aid` is generated HERE, by code, when `app.json` does not have one yet.
//
// Not by the agent (design D2b): `apps/{aid}` is a shelf every user of the deployment shares, and
// the rules' `allow create` asks only that you name yourself owner — so a memorable aid is
// first-come-first-served, cannot be checked for availability (the app document is not readable
// until you are on its roster), and frees up again when an app is deleted. A UUID has none of
// those properties, and a model asked to invent an identifier writes a memorable one.
//
// And it happens when `app.json` is WRITTEN rather than at publish: `acceptStorageSchema` refuses
// a firestore schema whose root declares no aid, so waiting until publish would make the author's
// first collection unopenable until they had published — the wrong end of the process to discover
// it from.
//
// The writing itself — atomic, mode-preserving, symlink-following, one at a time — is
// `updateManifest`'s, shared with the slug write-back for the reason both are here: `app.json`
// belongs to the author, and each of these changes exactly one key of it.
import { randomUUID } from "node:crypto";
import { updateManifest } from "./manifestWrite.js";

export interface EnsureAidSuccess {
  ok: true;
  aid: string;
  /** Whether this call minted it. Reported rather than inferred, because "your app.json now says
   *  something it did not say a moment ago" is a thing the operator should hear once. */
  created: boolean;
}

export type EnsureAidResult = EnsureAidSuccess | { ok: false; problems: string[] };

/** Read `<root>/app.json`, and give it an `aid` if it has none. */
export async function ensureAid(root: string): Promise<EnsureAidResult> {
  let minted: string | null = null;
  const updated = await updateManifest(root, (manifest) => {
    const current = manifest.aid;
    if (typeof current === "string" && current.length > 0) return null;
    minted = randomUUID();
    return { ...manifest, aid: minted };
  });
  if (!updated.ok) return updated;
  if (minted !== null) return { ok: true, aid: minted, created: true };

  const current = updated.manifest.aid;
  // Unreachable by construction — the mutation returns null only when it read a usable string —
  // but stated rather than asserted: this is the value every later step keys on.
  if (typeof current !== "string" || current.length === 0) {
    return { ok: false, problems: ["app.json has no usable aid, and one could not be generated."] };
  }
  return { ok: true, aid: current, created: false };
}
