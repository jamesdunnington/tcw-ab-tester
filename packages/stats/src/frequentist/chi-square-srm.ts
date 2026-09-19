import { regularizedLowerIncompleteGamma } from "../math/incomplete-gamma.js";

export interface SrmCheckResult {
  chiSquare: number;
  df: number;
  p: number;
  /** True when p < 0.001: the traffic split is not what was configured; do not trust the results. */
  isMismatched: boolean;
}

const SRM_P_THRESHOLD = 0.001;

/**
 * Sample Ratio Mismatch check: chi-square goodness-of-fit of the observed
 * visitor count per variant against the configured traffic split. A
 * mismatch usually signals an assignment/caching bug and invalidates every
 * other statistic, so it is checked first.
 *
 * @param observed visitor counts per variant, same order as `weights`
 * @param weights traffic weights (only relative proportions matter)
 */
export function chiSquareSrmCheck(observed: number[], weights: number[]): SrmCheckResult {
  if (observed.length !== weights.length || observed.length < 2) {
    throw new RangeError("chiSquareSrmCheck: observed and weights must be the same length, at least 2 variants");
  }
  const totalObserved = observed.reduce((a, b) => a + b, 0);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const df = observed.length - 1;
  if (totalObserved === 0 || totalWeight === 0) return { chiSquare: 0, df, p: 1, isMismatched: false };

  let chiSquare = 0;
  for (let i = 0; i < observed.length; i++) {
    const expected = totalObserved * (weights[i] / totalWeight);
    if (expected === 0) continue;
    chiSquare += (observed[i] - expected) ** 2 / expected;
  }
  const p = 1 - regularizedLowerIncompleteGamma(df / 2, chiSquare / 2);
  return { chiSquare, df, p, isMismatched: p < SRM_P_THRESHOLD };
}
