import { describe, it, expect } from "vitest";
import { extensionForImageMime, isPasteableImageMime } from "../../common/pastedImageTypes.js";

describe("extensionForImageMime", () => {
  it("maps the formats both agents read", () => {
    expect(extensionForImageMime("image/png")).toBe(".png");
    expect(extensionForImageMime("image/jpeg")).toBe(".jpg");
    expect(extensionForImageMime("image/gif")).toBe(".gif");
    expect(extensionForImageMime("image/webp")).toBe(".webp");
  });

  it("is case- and whitespace-insensitive (a clipboard type arrives as the source wrote it)", () => {
    expect(extensionForImageMime(" IMAGE/PNG ")).toBe(".png");
  });

  // SVG is a script-bearing document, not a screenshot.
  it("refuses svg and non-images", () => {
    expect(extensionForImageMime("image/svg+xml")).toBeNull();
    expect(extensionForImageMime("image/tiff")).toBeNull();
    expect(extensionForImageMime("text/plain")).toBeNull();
    expect(extensionForImageMime("")).toBeNull();
  });
});

// The client checks this before taking a paste away from xterm and the server checks it
// before writing; one list keeps a paste from being swallowed and then rejected.
describe("isPasteableImageMime", () => {
  it("agrees with the extension table", () => {
    expect(isPasteableImageMime("image/png")).toBe(true);
    expect(isPasteableImageMime("image/svg+xml")).toBe(false);
  });
});
