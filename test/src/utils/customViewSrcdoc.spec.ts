import { describe, it, expect } from "vitest";
import { buildCustomViewSrcdoc } from "../../../src/utils/customViewSrcdoc";

const boot = { slug: "watchlist", token: "tok", dataUrl: "/api/collections/watchlist/view-data", origin: "http://localhost:5173" };

describe("buildCustomViewSrcdoc", () => {
  it("injects __MC_VIEW with an absolutised dataUrl", () => {
    const out = buildCustomViewSrcdoc("<head></head>", boot);
    expect(out).toContain("window.__MC_VIEW=");
    expect(out).toContain('"dataUrl":"http://localhost:5173/api/collections/watchlist/view-data"');
    expect(out).toContain('"token":"tok"');
    expect(out).toContain('"slug":"watchlist"');
  });

  it("locks connect-src to the server origin only", () => {
    const out = buildCustomViewSrcdoc("<head></head>", boot);
    const csp = /content="([^"]*)"/.exec(out)?.[1] ?? "";
    expect(csp).toContain("connect-src http://localhost:5173");
    expect(csp).toContain("default-src 'none'");
    // connect-src must not be widened to https: (that's the exfil channel that matters).
    expect(csp).not.toMatch(/connect-src[^;]*https:/);
  });

  it("allows https: images/media (matches MulmoClaude's documented tradeoff)", () => {
    const csp = /content="([^"]*)"/.exec(buildCustomViewSrcdoc("<head></head>", boot))?.[1] ?? "";
    expect(csp).toMatch(/img-src[^;]*https:/);
    expect(csp).toMatch(/media-src[^;]*https:/);
  });

  it("injects into an existing <head>", () => {
    const out = buildCustomViewSrcdoc('<head data-x="1"><title>t</title></head>', boot);
    expect(out).toMatch(/<head data-x="1"><meta http-equiv="Content-Security-Policy"/);
  });

  it("wraps a fragment with no <head>", () => {
    const out = buildCustomViewSrcdoc("<div>hi</div>", boot);
    expect(out.startsWith("<!DOCTYPE html><html><head>")).toBe(true);
    expect(out).toContain("<body><div>hi</div></body>");
  });

  it("escapes < in the injected JSON so a hostile value can't break out of <script>", () => {
    const out = buildCustomViewSrcdoc("<head></head>", { ...boot, token: "</script><script>alert(1)" });
    expect(out).not.toContain("</script><script>alert(1)");
    expect(out).toContain("\\u003c/script>\\u003cscript>alert(1)");
  });

  // Regression: the view↔host bridge (onChange/openItem/startChat) must be defined, or
  // LLM-authored custom views throw "__MC_VIEW.openItem is not a function" when an item
  // is opened. The earlier MT port shipped only { slug, token, dataUrl } and crashed.
  it("defines the view↔host bridge functions on __MC_VIEW", () => {
    const out = buildCustomViewSrcdoc("<head></head>", boot);
    expect(out).toContain("v.onChange=function");
    expect(out).toContain("v.openItem=function");
    expect(out).toContain("v.startChat=function");
  });

  // The i18n half of the bridge (#1490). Run the injected bootstrap against a
  // stand-in `window` rather than string-matching it: what has to hold is what
  // `t()` RETURNS for an author who copied their app's vue-i18n locale JSON.
  const runBootstrap = (out: string): { locale: string; dict: Record<string, string>; t: (key: string, named?: Record<string, unknown>) => string } => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(out)?.[1] ?? "";
    const win: Record<string, unknown> = { addEventListener: () => {} };
    // The bootstrap only EXISTS as a string (it is inlined into the iframe's <script>), so running it
    // is the only way to assert what a view actually gets. The input is this repo's own literal, not
    // anything a user or collection author can influence.
    // eslint-disable-next-line sonarjs/code-eval, no-new-func
    new Function("window", script)(win);
    return win.__MC_VIEW as ReturnType<typeof runBootstrap>;
  };

  it("carries the host-picked locale + dict into __MC_VIEW", () => {
    const out = buildCustomViewSrcdoc("<head></head>", { ...boot, locale: "ja", dict: { greet: "こんにちは {name}" } });
    const view = runBootstrap(out);
    expect(view.locale).toBe("ja");
    expect(view.dict).toEqual({ greet: "こんにちは {name}" });
  });

  it("t() substitutes named placeholders and falls back to the key", () => {
    const view = runBootstrap(buildCustomViewSrcdoc("<head></head>", { ...boot, locale: "en", dict: { greet: "Hello {name}" } }));
    expect(view.t("greet", { name: "Ada" })).toBe("Hello Ada");
    expect(view.t("greet")).toBe("Hello {name}");
    expect(view.t("missing")).toBe("missing");
  });

  // A view whose collection declares no i18n still gets a working t() — that is
  // what lets an i18n-less view use t() unconditionally.
  it("defaults to an empty dict when the host passes none", () => {
    const view = runBootstrap(buildCustomViewSrcdoc("<head></head>", boot));
    expect(view.locale).toBe("");
    expect(view.dict).toEqual({});
    expect(view.t("anything")).toBe("anything");
  });

  it("includes origin so openItem/startChat can postMessage the known parent", () => {
    const out = buildCustomViewSrcdoc("<head></head>", boot);
    expect(out).toContain('"origin":"http://localhost:5173"');
    // openItem/startChat target v.origin (not "*").
    expect(out).toContain("'mc-open-item'");
    expect(out).toContain("'mc-start-chat'");
    expect(out).toContain("},v.origin)");
  });
});
