import { normalQuantile } from "./math/normal.js";

/**
 * Pre-launch sample-size calculators (docs/PLAN.md section 5). Both return
 * the required observations PER VARIANT for a two-sided test.
 */

/**
 * Two-proportion z-test sample size.
 * @param baselineRate control conversion rate, e.g. 0.05
 * @param relativeMde smallest relative lift worth detecting, e.g. 0.2 for +20%
 */
export function sampleSizeForProportions(
  baselineRate: number,
  relativeMde: number,
  options: { alpha?: number; power?: number } = {},
): number {
  if (baselineRate <= 0 || baselineRate >= 1) throw new RangeError("baselineRate must be in (0, 1)");
  if (relativeMde <= 0) throw new RangeError("relativeMde must be > 0");
  const alpha = options.alpha ?? 0.05;
  const power = options.power ?? 0.8;

  const p1 = baselineRate;
  const p2 = Math.min(0.999, baselineRate * (1 + relativeMde));
  const zAlpha = normalQuantile(1 - alpha / 2);
  const zBeta = normalQuantile(power);
  const pBar = (p1 + p2) / 2;

  const numerator = (zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2;
  return Math.ceil(numerator / (p2 - p1) ** 2);
}

/**
 * Two-sample t-test sample size (normal approximation).
 * @param baselineStd standard deviation of the metric in the control
 * @param absoluteMde smallest absolute difference in means worth detecting
 */
export function sampleSizeForMeans(
  baselineStd: number,
  absoluteMde: number,
  options: { alpha?: number; power?: number } = {},
): number {
  if (baselineStd <= 0) throw new RangeError("baselineStd must be > 0");
  if (absoluteMde <= 0) throw new RangeError("absoluteMde must be > 0");
  const alpha = options.alpha ?? 0.05;
  const power = options.power ?? 0.8;
  const zAlpha = normalQuantile(1 - alpha / 2);
  const zBeta = normalQuantile(power);
  return Math.ceil((2 * baselineStd ** 2 * (zAlpha + zBeta) ** 2) / absoluteMde ** 2);
}
