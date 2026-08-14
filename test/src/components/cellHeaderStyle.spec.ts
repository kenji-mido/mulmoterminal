import { describe, it, expect } from "vitest";
import { headerStyleFor, headerStatusStyleFor, cellStyleFor, terminalHeaderStyleFor } from "../../../src/components/cellHeaderStyle.js";
import type { HeaderChrome } from "../../../common/headerStatusColors.js";

const chrome = (over: Partial<HeaderChrome> = {}): HeaderChrome => ({
  headerColor: null,
  headerTextColor: null,
  statusColors: null,
  tint: null,
  ...over,
});

describe("headerStyleFor", () => {
  it("maps a background + text color to the header CSS variables", () => {
    expect(headerStyleFor("#ff2e63", "#ffffff")).toEqual({
      "--cell-header-bg": "#ff2e63",
      "--cell-header-fg": "#ffffff",
    });
  });

  it("emits only the variable that is set", () => {
    expect(headerStyleFor(null, "#abcdef")).toEqual({ "--cell-header-fg": "#abcdef" });
  });

  it("returns an empty style when nothing is configured", () => {
    expect(headerStyleFor(null, undefined)).toEqual({});
  });

  it("drops non-hex values so garbage can't reach the inline style", () => {
    expect(headerStyleFor("red", "rgb(1,2,3)")).toEqual({});
    expect(headerStyleFor("#fff", "#12345")).toEqual({}); // wrong length — and #fff is not a colour here either
    expect(headerStyleFor("javascript:alert(1)", "#000000")).toEqual({ "--cell-header-fg": "#000000" });
  });

  // A directory that declares `headerColor` and no `headerTextColor` is the issue's own
  // reproduction (#1591): without a derived ink the text keeps a colour chosen for the theme's
  // panel, which on a saturated header is the background. The values come from
  // common/chromeFromColor.ts, so a derived cell header and a repo.json-derived one agree.
  it("derives the text colour from the background when the directory declared none", () => {
    expect(headerStyleFor("#241640", null)).toEqual({ "--cell-header-bg": "#241640", "--cell-header-fg": "#ffffff" });
    expect(headerStyleFor("#ffe8a3", null)).toEqual({ "--cell-header-bg": "#ffe8a3", "--cell-header-fg": "#1b2430" });
    // The issue's own colour, and it goes DARK rather than the white a strong red looks like it
    // wants: 4.94:1 against black, 4.27:1 against white. It is also PURE black — the softened ink
    // this file's pale case gets would be 3.68:1, below AA (see chromeFromColor.spec.ts).
    expect(headerStyleFor("#e8341c", null)).toEqual({ "--cell-header-bg": "#e8341c", "--cell-header-fg": "#000000" });
  });

  it("prefers the declared text colour over the derived one", () => {
    expect(headerStyleFor("#e8341c", "#101010")).toEqual({ "--cell-header-bg": "#e8341c", "--cell-header-fg": "#101010" });
  });
});

describe("headerStatusStyleFor", () => {
  it("paints the directory's colour while idle", () => {
    expect(headerStatusStyleFor("idle", chrome({ headerColor: "#8e44ad" }))).toEqual({ "--cell-header-bg": "#8e44ad", "--cell-header-fg": "#ffffff" });
  });

  // #1591 measured off the reporter's screenshot: the header goes to --bg-selected (#d6e4fb in
  // Daylight) while the session runs, and the white chosen for #8e44ad stayed on it at 1.15:1.
  // Emitting NEITHER variable is what hands both back to the theme, which pairs its own wash with
  // its own ink.
  it("hands both back to the theme in a state whose background the theme replaces", () => {
    for (const status of ["working", "done", "blocked"] as const) {
      expect(headerStatusStyleFor(status, chrome({ headerColor: "#8e44ad", headerTextColor: "#ffffff" }))).toEqual({});
    }
  });

  it("uses a configured colour for that status, deriving the ink when only the background is given", () => {
    const configured = chrome({ headerColor: "#8e44ad", headerTextColor: "#ffffff", statusColors: { working: { background: "#ffe8a3", text: null } } });
    expect(headerStatusStyleFor("working", configured)).toEqual({ "--cell-header-bg": "#ffe8a3", "--cell-header-fg": "#1b2430" });
    // The statuses it did not name are still the theme's.
    expect(headerStatusStyleFor("done", configured)).toEqual({});
  });

  it("keeps the directory's colour in working / done when the tint is off", () => {
    const noTint = chrome({ headerColor: "#8e44ad", tint: "none" });
    expect(headerStatusStyleFor("working", noTint)).toEqual({ "--cell-header-bg": "#8e44ad", "--cell-header-fg": "#ffffff" });
    expect(headerStatusStyleFor("done", noTint)).toEqual({ "--cell-header-bg": "#8e44ad", "--cell-header-fg": "#ffffff" });
  });

  // `none` means "keep my palette", and blocked is the state where nothing proceeds until the user
  // answers. Naming a blocked colour outright still works — that is a decision, not a side effect.
  it("does not let the tint switch take the amber off a blocked cell", () => {
    expect(headerStatusStyleFor("blocked", chrome({ headerColor: "#8e44ad", tint: "none" }))).toEqual({});
    expect(headerStatusStyleFor("blocked", chrome({ tint: "none", statusColors: { blocked: { background: "#7c2d12", text: null } } }))).toEqual({
      "--cell-header-bg": "#7c2d12",
      "--cell-header-fg": "#ffffff",
    });
  });
});

describe("cellStyleFor", () => {
  it("maps body / border / dot / button colors to the cell CSS variables", () => {
    expect(cellStyleFor("#101014", "#2a2a4e", "#00e676", "#c7cdf0")).toEqual({
      "--cell-bg": "#101014",
      "--cell-border": "#2a2a4e",
      "--cell-dot": "#00e676",
      "--cell-btn": "#c7cdf0",
    });
  });

  it("emits only the variables that are set", () => {
    expect(cellStyleFor(null, "#2a2a4e", null, null)).toEqual({ "--cell-border": "#2a2a4e" });
    expect(cellStyleFor("#101014", null, null, null)).toEqual({ "--cell-bg": "#101014" });
  });

  it("returns an empty style when nothing is configured", () => {
    expect(cellStyleFor(null, undefined, null, undefined)).toEqual({});
  });

  it("drops non-hex values", () => {
    expect(cellStyleFor("blue", "#12", "rgb(0,0,0)", "#abcdef")).toEqual({ "--cell-btn": "#abcdef" });
  });
});

describe("terminalHeaderStyleFor", () => {
  it("reuses the header bg/fg vars and adds the button var", () => {
    expect(terminalHeaderStyleFor("#241640", "#ffd166", "#4dd0e1")).toEqual({
      "--cell-header-bg": "#241640",
      "--cell-header-fg": "#ffd166",
      "--cell-btn": "#4dd0e1",
    });
  });

  it("emits only the set + valid vars", () => {
    expect(terminalHeaderStyleFor("#241640", null, "nope")).toEqual({ "--cell-header-bg": "#241640", "--cell-header-fg": "#ffffff" });
    expect(terminalHeaderStyleFor(null, null, null)).toEqual({});
  });

  // This row keeps the directory's background whatever the session is doing, so it always derives.
  it("derives the text colour too, since no status replaces this row's background", () => {
    expect(terminalHeaderStyleFor("#ffe8a3", null, null)).toEqual({ "--cell-header-bg": "#ffe8a3", "--cell-header-fg": "#1b2430" });
  });
});
