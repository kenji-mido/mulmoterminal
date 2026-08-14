// What counts as a directory's icon image (#1421). BOTH sides decide from this list, so it lives
// here rather than in either of them: the server only serves a type it can name a Content-Type
// for, and the client only puts a src it recognises into an <img>. Were the two to drift, a
// directory would configure an icon that one side accepts and the other silently drops — which
// looks exactly like a mistyped path.
//
// SVG is present, unlike common/pastedImageTypes.ts: this is a logo a user committed to their own
// repository, not a screenshot off the clipboard, and a logo is very often an SVG. What that costs
// is handled where it is served (server/routes/dir-routes.ts sets `Content-Security-Policy:
// sandbox`), not by refusing the format.
const MIME_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".bmp", "image/bmp"],
]);

/** The MIME type for an icon file path, or null when its extension isn't an image we serve. */
export function dirIconMime(filePath: string): string | null {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return null;
  return MIME_BY_EXTENSION.get(filePath.slice(dot).toLowerCase()) ?? null;
}

// A data: URI carrying an image is inlined into /api/dir-config, which EVERY cell in the
// directory fetches — so the cap is about the config response, not about the picture. 64 KB is
// several times a 64x64 PNG and still small enough that a cell's config stays a config; anything
// larger belongs in a file the directory points at, which is served once and then cached.
export const DIR_ICON_MAX_CHARS = 65536;

// Remote sources the browser may load directly. `data:` is restricted to the same image types as
// a file — `data:text/html` in an <img> renders nothing, but it must not be something this app
// hands onward as "an image the directory configured".
const REMOTE_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);
const DATA_IMAGE_RE = /^data:(image\/[a-z0-9.+-]+)[;,]/i;
const IMAGE_MIMES: ReadonlySet<string> = new Set(MIME_BY_EXTENSION.values());

/** Whether the browser may load this string directly — an http(s) URL, or a data: image. */
export function isRemoteDirIconUrl(raw: string): boolean {
  if (raw.length > DIR_ICON_MAX_CHARS) return false;
  const dataMime = DATA_IMAGE_RE.exec(raw)?.[1];
  if (dataMime) return IMAGE_MIMES.has(dataMime.toLowerCase());
  try {
    return REMOTE_SCHEMES.has(new URL(raw).protocol);
  } catch {
    return false;
  }
}

// The route the server hands back for a directory's own file, so the client can tell that apart
// from an arbitrary same-origin path arriving on the wire.
export const DIR_ICON_ROUTE = "/api/dir-icon";

/** Whether a resolved `iconUrl` off the wire may go into an `<img src>`: this app's own icon
 *  route, or a remote source. The server already decided; this is the client's own boundary
 *  check, so a widened response can't put an unexpected scheme into the DOM. */
export function isUsableDirIconSrc(raw: unknown): raw is string {
  if (typeof raw !== "string" || !raw) return false;
  return raw.startsWith(`${DIR_ICON_ROUTE}?`) || isRemoteDirIconUrl(raw);
}
