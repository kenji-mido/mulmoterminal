// The `sizes` syntax two icon sources share: the Web App Manifest's `icons[]` and `repo.json`'s
// `icon[]`, which borrows the spelling on purpose rather than inventing a second one.
//
// Written twice before jscpd pointed it out on #1445 — once for each reader — which is exactly how
// two callers end up disagreeing about what `any` means.
const VECTOR_AREA = Number.MAX_SAFE_INTEGER;

/** The largest area a `sizes` string declares. `any` (a vector) outranks every pixel count, and
 *  anything unparseable counts as zero rather than disqualifying the icon. */
export function largestIconArea(sizes: unknown): number {
  if (typeof sizes !== "string") return 0;
  return sizes
    .split(/\s+/)
    .map((token) => {
      if (token.toLowerCase() === "any") return VECTOR_AREA;
      const wh = /^(\d+)x(\d+)$/i.exec(token);
      return wh ? Number(wh[1]) * Number(wh[2]) : 0;
    })
    .reduce((max, area) => Math.max(max, area), 0);
}
