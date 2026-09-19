/**
 * Holm-Bonferroni step-down correction for multiple comparisons, applied to
 * the frequentist p-values when a test has more than two variants (A/B/n).
 * Returns adjusted p-values in the SAME order as the input.
 */
export function holmBonferroniCorrection(pValues: number[]): number[] {
  const m = pValues.length;
  if (m === 0) return [];
  const indexed = pValues.map((p, originalIndex) => ({ p, originalIndex }));
  indexed.sort((a, b) => a.p - b.p);
  const adjustedSorted = new Array<number>(m);
  let runningMax = 0;
  for (let i = 0; i < m; i++) {
    runningMax = Math.max(runningMax, (m - i) * indexed[i].p);
    adjustedSorted[i] = Math.min(1, runningMax);
  }
  const result = new Array<number>(m);
  indexed.forEach((entry, sortedIndex) => {
    result[entry.originalIndex] = adjustedSorted[sortedIndex];
  });
  return result;
}
