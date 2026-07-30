// The image types a pasted screenshot can be saved as. BOTH sides decide from this list, so
// it lives here rather than in either of them: the client only takes a paste away from xterm
// when the server will accept it, and the server only writes a type it can name a file for.
// Were the two to drift, a paste would vanish from the terminal and then fail to upload —
// the user would see nothing happen at all.
//
// SVG is deliberately absent: it is a script-bearing document, not a screenshot, and nothing
// puts one on the clipboard as an image.
const EXTENSION_BY_MIME: ReadonlyMap<string, string> = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
]);

/** The file extension for a pasteable image type, or null when it isn't one. */
export function extensionForImageMime(mime: string): string | null {
  return EXTENSION_BY_MIME.get(mime.toLowerCase().trim()) ?? null;
}

export function isPasteableImageMime(mime: string): boolean {
  return extensionForImageMime(mime) !== null;
}
