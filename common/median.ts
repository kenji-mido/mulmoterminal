// The middle value of a set of numbers, or null when there is nothing to measure.
//
// For an even count there are two middle values; the median is their AVERAGE. Returning
// the upper one instead skews every even-length measurement toward the slower half — which
// is what happened to the model-trial timings that get transcribed into the preset table
// (a 2/3-passing model records two numbers, an even count, on every run).
export const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // Read once each: `sorted[mid]` is `number | undefined` under noUncheckedIndexedAccess, and the
  // length checks above are what actually rule that out.
  const middle = sorted[mid];
  if (middle === undefined) return null;
  if (sorted.length % 2 === 1) return middle;
  const below = sorted[mid - 1];
  return below === undefined ? middle : (below + middle) / 2;
};
