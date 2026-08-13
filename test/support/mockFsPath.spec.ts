// @vitest-environment node
// The Windows spelling, asserted on whatever platform is running.
//
// This helper exists because two registry specs read a `\`-separated path as one nameless blob and
// went red on Windows only, on 12 consecutive daily runs. So the case that matters is the one this
// machine will never produce on its own — it is passed in literally.
import { describe, it, expect } from "vitest";

import { mockedFileName } from "./mockFsPath.js";

describe("mockedFileName", () => {
  it("reads the name off a Windows path", () => {
    expect(mockedFileName("C:\\Users\\runneradmin\\.mulmoterminal\\unplaced-sessions.json")).toBe("unplaced-sessions.json");
  });

  it("reads the name off a POSIX path", () => {
    expect(mockedFileName("/Users/me/.mulmoterminal/unplaced-sessions.json")).toBe("unplaced-sessions.json");
  });

  it("leaves a bare name alone", () => {
    expect(mockedFileName("placed-sessions.json")).toBe("placed-sessions.json");
  });

  // The reason callers compare with `===`: one of these names is a suffix of the other, so
  // `endsWith` would read the two logs as one and count every unplaced line as a placed one.
  it("tells the two sessions logs apart on both separators", () => {
    const unplaced = ["/home/me/.mulmoterminal/unplaced-sessions.json", "C:\\Users\\me\\.mulmoterminal\\unplaced-sessions.json"];
    unplaced.forEach((file) => expect(mockedFileName(file)).not.toBe("placed-sessions.json"));
  });

  // `readFile` doubles are typed `(file: unknown)` because that is what vi.fn hands them.
  it("accepts whatever the double was called with", () => {
    expect(mockedFileName(undefined)).toBe("undefined");
  });
});
