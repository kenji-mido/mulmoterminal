// @vitest-environment node
//
// The reader for a report the PANE renders a verdict from. What it must never do is turn a
// response it cannot fully read into a clean bill of health.
import { describe, it, expect } from "vitest";
import { asSelfContainmentReport, isSelfContainmentSeverity } from "../../common/collectionPortability";

const ok = {
  slug: "notes",
  portable: false,
  findings: [{ code: "data-ignored", severity: "blocker", message: "The records are excluded by .gitignore." }],
};

describe("asSelfContainmentReport", () => {
  it("reads a well-formed report", () => {
    expect(asSelfContainmentReport(ok)).toEqual(ok);
  });

  it("keeps a code it has never heard of — a newer server's finding still says something", () => {
    const body = { ...ok, findings: [{ code: "invented-later", severity: "warning", message: "Something new." }] };
    expect(asSelfContainmentReport(body)?.findings[0]?.code).toBe("invented-later");
  });

  // The failure this rejection exists to prevent: drop the unreadable finding and a report whose
  // ONLY blocker was that finding comes back as `findings: []`, which the pane renders as
  // "nothing to fix — it travels" about a collection that does not.
  it("REJECTS the whole report when a finding is unreadable, rather than dropping it", () => {
    const cases = [
      { ...ok, findings: [{ code: "data-ignored", severity: "catastrophic", message: "x" }] },
      { ...ok, findings: [{ code: "data-ignored", severity: "blocker" }] },
      { ...ok, findings: [{ code: 7, severity: "blocker", message: "x" }] },
      { ...ok, findings: [ok.findings[0], null] },
      { ...ok, findings: [ok.findings[0], { code: "x", severity: "nope", message: "y" }] },
    ];
    for (const body of cases) expect(asSelfContainmentReport(body)).toBeNull();
  });

  it("rejects a body that is not a report at all", () => {
    for (const body of [null, undefined, "no", 7, {}, { slug: "a" }, { slug: "a", portable: "yes", findings: [] }, { slug: "a", portable: true }]) {
      expect(asSelfContainmentReport(body)).toBeNull();
    }
  });

  it("accepts an empty findings list — that IS the clean answer", () => {
    expect(asSelfContainmentReport({ slug: "notes", portable: true, findings: [] })).toEqual({ slug: "notes", portable: true, findings: [] });
  });
});

describe("isSelfContainmentSeverity", () => {
  it("admits exactly the three the pane can render", () => {
    expect(["blocker", "warning", "info"].every(isSelfContainmentSeverity)).toBe(true);
    expect([undefined, null, "", "BLOCKER", "critical", 1].some(isSelfContainmentSeverity)).toBe(false);
  });
});
