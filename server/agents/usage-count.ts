import { finiteNumber } from "../../common/finiteNumber.js";

/**
 * One token count off an agent's own JSON.
 *
 * Zero — not null — for anything missing, negative or not a number, because every caller is
 * ACCUMULATING: a field an agent did not write contributes nothing, and that is the same answer as
 * a field it wrote as 0. (The opposite of `finiteNumber`'s rule for gauges, which this is built on:
 * there a missing value and a zero mean different things.)
 *
 * Shared by grok's and muse's folds rather than written in each, because it is the same question
 * about the same kind of file — and it was the one piece the duplication scan could see them
 * agreeing on.
 */
export const usageCount = (record: Record<string, unknown>, key: string): number => {
  const value = finiteNumber(record[key]);
  return value !== null && value > 0 ? value : 0;
};
