import { createRng, sampleDirichletUniformWeights, type Rng } from "../math/random.js";

export interface ContinuousVariantInput {
  key: string;
  values: number[];
}

export interface ContinuousVariantResult {
  key: string;
  mean: number;
  pBest: number;
  /** In the units `transform` produces (log1p-space when transform is "log"). */
  expectedLoss: number;
  credibleInterval: [number, number];
}

const DEFAULT_DRAWS = 10_000;
const WINSORIZE_PERCENTILE = 0.99;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]; // nearest-rank
}

/** Caps values above the 99th percentile so one runaway session cannot dominate the mean. */
export function winsorize(values: number[]): number[] {
  if (values.length < 5) return values;
  const cap = percentile([...values].sort((a, b) => a - b), WINSORIZE_PERCENTILE);
  return values.map((v) => Math.min(v, cap));
}

function weightedMean(values: number[], weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i] * weights[i];
  return sum;
}

/**
 * Bayesian bootstrap (Rubin 1981) for a continuous metric (Engagement Score,
 * active time). Each posterior draw of a variant's mean reweights its own
 * sample with Dirichlet(1,...,1) weights, so no normality is assumed.
 *
 * @param transform "log" applies log1p first (for strictly-positive, skewed
 *   metrics like active time) and undoes it for the reported mean/CI;
 *   expectedLoss stays in log1p-space. Default "none".
 */
export function analyzeContinuousMetric(
  variants: ContinuousVariantInput[],
  options: { draws?: number; rng?: Rng; transform?: "log" | "none" } = {},
): ContinuousVariantResult[] {
  if (variants.length < 2) throw new RangeError("analyzeContinuousMetric: need at least 2 variants to compare");
  if (variants.some((v) => v.values.length < 2)) {
    throw new RangeError("analyzeContinuousMetric: every variant needs at least 2 observations");
  }

  const draws = options.draws ?? DEFAULT_DRAWS;
  const rng = options.rng ?? createRng();
  const transform = options.transform ?? "none";

  const prepared = variants.map((v) => {
    const w = winsorize(v.values);
    return transform === "log" ? w.map((x) => Math.log1p(Math.max(0, x))) : w;
  });

  const bestCount = new Array(variants.length).fill(0);
  const lossSum = new Array(variants.length).fill(0);
  const meansByVariant: number[][] = variants.map(() => []);

  for (let d = 0; d < draws; d++) {
    const drawMeans = prepared.map((vals) => weightedMean(vals, sampleDirichletUniformWeights(rng, vals.length)));
    let bestIdx = 0;
    for (let i = 1; i < drawMeans.length; i++) if (drawMeans[i] > drawMeans[bestIdx]) bestIdx = i;
    bestCount[bestIdx] += 1;
    for (let i = 0; i < drawMeans.length; i++) {
      lossSum[i] += drawMeans[bestIdx] - drawMeans[i];
      meansByVariant[i].push(drawMeans[i]);
    }
  }

  const untransform = (x: number) => (transform === "log" ? Math.expm1(x) : x);

  return variants.map((v, i) => {
    const samples = meansByVariant[i].slice().sort((a, b) => a - b);
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    return {
      key: v.key,
      mean: untransform(avg),
      pBest: bestCount[i] / draws,
      expectedLoss: lossSum[i] / draws,
      credibleInterval: [untransform(samples[Math.floor(0.025 * samples.length)]), untransform(samples[Math.floor(0.975 * samples.length)])],
    };
  });
}

/** 95% bootstrap CI on the relative lift ((meanVariant - meanControl) / meanControl). */
export function bootstrapRelativeLiftCI(
  control: number[],
  variant: number[],
  options: { draws?: number; rng?: Rng } = {},
): [number, number] {
  const draws = options.draws ?? DEFAULT_DRAWS;
  const rng = options.rng ?? createRng();
  const lifts: number[] = [];
  for (let d = 0; d < draws; d++) {
    const mc = weightedMean(control, sampleDirichletUniformWeights(rng, control.length));
    const mv = weightedMean(variant, sampleDirichletUniformWeights(rng, variant.length));
    if (mc !== 0) lifts.push((mv - mc) / mc);
  }
  if (lifts.length === 0) return [0, 0];
  lifts.sort((a, b) => a - b);
  return [percentile(lifts, 0.025), percentile(lifts, 0.975)];
}
