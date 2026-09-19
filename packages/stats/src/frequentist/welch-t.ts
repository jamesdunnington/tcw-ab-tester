import { regularizedIncompleteBeta } from "../math/incomplete-beta.js";

export interface WelchTTestResult {
  t: number;
  df: number;
  /** Two-tailed p-value. */
  p: number;
  meanA: number;
  meanB: number;
  /** (meanB - meanA) / meanA, or null if meanA is 0. */
  relativeLift: number | null;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function variance(xs: number[], m: number): number {
  if (xs.length < 2) return 0;
  return xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
}

/**
 * Welch's unequal-variance two-sample t-test: the frequentist confirmation
 * shown next to the Bayesian bootstrap result for a continuous metric.
 * Assumes neither equal variance nor equal sample size.
 */
export function welchTTest(a: number[], b: number[]): WelchTTestResult {
  if (a.length < 2 || b.length < 2) {
    throw new RangeError("welchTTest: each sample needs at least 2 observations");
  }
  const meanA = mean(a);
  const meanB = mean(b);
  const seA = variance(a, meanA) / a.length;
  const seB = variance(b, meanB) / b.length;
  const se = Math.sqrt(seA + seB);
  const t = se === 0 ? 0 : (meanB - meanA) / se;
  // Welch-Satterthwaite degrees of freedom.
  const df = se === 0 ? a.length + b.length - 2 : (seA + seB) ** 2 / (seA ** 2 / (a.length - 1) + seB ** 2 / (b.length - 1));
  const p = regularizedIncompleteBeta(df / (df + t * t), df / 2, 0.5);
  return { t, df, p, meanA, meanB, relativeLift: meanA !== 0 ? (meanB - meanA) / meanA : null };
}
