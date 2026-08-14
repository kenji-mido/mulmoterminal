// @vitest-environment node
import { describe, it, expect } from "vitest";
import { DIR_ICON_MAX_CHARS, dirIconMime, isRemoteDirIconUrl, isUsableDirIconSrc } from "../../common/dirIcon";

describe("dirIconMime", () => {
  it.each([
    ["logo.png", "image/png"],
    ["logo.jpg", "image/jpeg"],
    ["logo.jpeg", "image/jpeg"],
    ["logo.gif", "image/gif"],
    ["logo.webp", "image/webp"],
    ["logo.avif", "image/avif"],
    ["logo.svg", "image/svg+xml"],
    ["logo.ico", "image/x-icon"],
    ["logo.bmp", "image/bmp"],
  ])("names the type of %s", (file, mime) => {
    expect(dirIconMime(file)).toBe(mime);
  });

  it("is case-insensitive about the extension", () => {
    expect(dirIconMime("assets/LOGO.PNG")).toBe("image/png");
  });

  // The server sets Content-Type from this, so a file it cannot name is a file it must not serve
  // — otherwise `icon: ".env"` would be handed to the browser as whatever express guessed.
  it.each(["notes.md", "secret.env", "archive.tar.gz", "logo", "logo.png.txt", ".gitignore"])("refuses %s", (file) => {
    expect(dirIconMime(file)).toBeNull();
  });
});

describe("isRemoteDirIconUrl", () => {
  it.each(["https://example.com/logo.png", "http://localhost:8080/logo.gif", "data:image/png;base64,AAAA", "data:image/svg+xml,%3Csvg%2F%3E"])(
    "accepts %s",
    (url) => {
      expect(isRemoteDirIconUrl(url)).toBe(true);
    },
  );

  // A data: URI is passed to the browser as-is, so the type inside it has to be one of ours: a
  // `data:text/html` reaching an <img> renders nothing, but this app must not be the thing that
  // called it an image and handed it on.
  it.each(["data:text/html,<b>x</b>", "data:application/json,{}", "data:image/png", "javascript:alert(1)", "file:///etc/passwd", "blob:https://x/y"])(
    "refuses %s",
    (url) => {
      expect(isRemoteDirIconUrl(url)).toBe(false);
    },
  );

  it("refuses a relative path — that is a file, resolved against the directory", () => {
    expect(isRemoteDirIconUrl("assets/logo.png")).toBe(false);
  });

  // The cap is about the /api/dir-config response an inline image rides in, so it applies before
  // the URL is even parsed.
  it("refuses a data: URI past the cap", () => {
    const oversized = `data:image/png;base64,${"A".repeat(DIR_ICON_MAX_CHARS)}`;
    expect(isRemoteDirIconUrl(oversized)).toBe(false);
  });
});

describe("isUsableDirIconSrc", () => {
  it("accepts this app's own icon route", () => {
    expect(isUsableDirIconSrc("/api/dir-icon?cwd=%2Fwork%2Fproj")).toBe(true);
  });

  // The client's own boundary: only the icon route and the remote sources above may become an
  // <img src>, so a widened server response cannot put an arbitrary same-origin path in the DOM.
  it.each(["/api/files?path=/etc/passwd", "/api/dir-icon", "../logo.png", "", null, undefined, 42, {}])("refuses %s", (value) => {
    expect(isUsableDirIconSrc(value)).toBe(false);
  });
});
