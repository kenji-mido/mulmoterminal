// A directory's icon image (#1421): the picture a project puts in its own `.mulmoterminal.json`
// so its cells are recognisable at a glance, the way `name` and the chrome colours already are.
//
// Two shapes, because they are served by different things. A relative path is a file inside the
// project, which only this server can read — confined exactly like `sound` (dir-config.ts) and
// streamed back through /api/dir-icon. An http(s) or data: URL is loaded by the browser itself,
// so nothing here touches it beyond deciding that it is one.
import { resolveFileWithinDir } from "./dir-file.js";
import { DIR_ICON_MAX_CHARS, dirIconMime, isRemoteDirIconUrl } from "../../common/dirIcon.js";

// `ref` is the path AS WRITTEN, kept beside the resolved one because a worktree inherits this
// key: a config derived from an absolute path would be rejected by the very rule that produced
// it (relative only), while the relative path resolves again in the worktree's own tree.
export type DirIconFile = { source: "file"; path: string; ref: string; mime: string };
export type DirIcon = DirIconFile | { source: "url"; url: string };

// Confine a configured icon to a real image file INSIDE cwd — the shared rule (dir-file.ts), the
// same one `sound` is held to. The extension check is this key's own: a path that IS inside the
// directory but names something the browser cannot render is still not an icon.
export function resolveIconFile(cwd: string, ref: string): DirIconFile | null {
  const mime = dirIconMime(ref);
  if (!mime) return null;
  const resolved = resolveFileWithinDir(cwd, ref);
  return resolved ? { source: "file", path: resolved, ref, mime } : null;
}

// What the FILE said, before anything is looked for on disk. Four answers, because three
// different callers need different cuts of them:
//
//   an icon    the file named a usable one
//   "off"      an explicit `false` — no icon here, and do not go looking
//   "invalid"  the file named something unusable (a typo, a file since renamed)
//   null       the file said nothing about an icon
//
// Auto-detection (#1428) runs for `null` ALONE. `"invalid"` is deliberately not folded into it:
// a broken setting has to look broken, and quietly showing the repository's favicon instead would
// hide exactly the mistake the settings preview exists to surface. It is not folded into `"off"`
// either, because that one WORKED and this one did not — which is the applied/ignored split the
// preview reports.
export type DirIconSetting = DirIcon | "off" | "invalid" | null;

/** The icon a directory configured — see DirIconSetting for what each answer means. */
export function resolveDirIcon(cwd: string, input: unknown): DirIconSetting {
  if (input === false) return "off";
  if (input === undefined) return null;
  if (typeof input !== "string") return "invalid";
  const raw = input.trim();
  if (!raw || raw.length > DIR_ICON_MAX_CHARS) return "invalid";
  if (isRemoteDirIconUrl(raw)) return { source: "url", url: raw };
  return resolveIconFile(cwd, raw) ?? "invalid";
}

/** Whether the file had its say about the icon — an image, an opt-out, or something broken. Only
 *  a directory that said nothing at all gets searched. */
export const dirIconNamed = (setting: DirIconSetting): boolean => setting !== null;

/** The image out of a setting — null for everything that isn't one. */
export const dirIconImage = (setting: DirIconSetting): DirIcon | null => (typeof setting === "object" ? setting : null);

/** What to write into a config file to mean this setting again — the relative path as the user
 *  typed it, the remote URL, or `false` for an explicit opt-out. Null when the file said nothing,
 *  which a derived config expresses by omitting the key. */
export function dirIconRef(setting: DirIconSetting): string | false | null {
  if (setting === "off") return false;
  const icon = dirIconImage(setting);
  if (!icon) return null; // unset, or something the loader could not use — neither is worth copying
  return icon.source === "file" ? icon.ref : icon.url;
}
