// Deciding whether a paste is an image the terminal should intercept. Pure so the rule can
// be unit-tested without a real ClipboardEvent — the same reason dropPaths.ts exists.

import { isPasteableImageMime } from "../../common/pastedImageTypes";

// Two conditions, and the second is the one that keeps the terminal usable.
//
// A type the server can save: taking a paste away from xterm and THEN failing the upload
// leaves the user with nothing happening at all, so anything we can't store stays a normal
// paste.
//
// And no text alongside it: a screenshot (Cmd+Shift+4, Win+Shift+S) puts an image on the
// clipboard and nothing else, while copying rich text from a web page puts text/plain there
// too. Intercepting those would break pasting text, the terminal's most-used gesture.
// text/html WITHOUT text/plain — an image copied from a page — is still treated as an image,
// which is the useful reading of that paste here.
//
// `itemTypes` is not a second opinion on the same data — on Windows + Chrome it is the ONLY
// place the MIME appears. There `types` is `["Files"]` alone and `items[0].type` is
// `image/png`, so a types-only check declined the paste, and with no text on the clipboard
// either xterm had nothing to paste: a silent no-op on the very platform #938 was filed from
// (measured on Windows 11 + Chrome 150 by the reporter).
export function shouldInterceptImagePaste(types: readonly string[], itemTypes: readonly string[] = []): boolean {
  if (types.includes("text/plain")) return false;
  return types.some(isPasteableImageMime) || itemTypes.some(isPasteableImageMime);
}

/** The image file on the clipboard, or null when this paste isn't one to intercept. */
export function pastedImageFile(clipboard: DataTransfer | null): File | null {
  if (!clipboard) return null;
  const items = [...clipboard.items];
  if (
    !shouldInterceptImagePaste(
      clipboard.types,
      items.map((entry) => entry.type),
    )
  )
    return null;
  const item = items.find((entry) => entry.kind === "file" && isPasteableImageMime(entry.type));
  return item?.getAsFile() ?? null;
}
