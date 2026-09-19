import { createRng, sampleBeta, type Rng } from "../math/random.js";

export interface BinaryVariantInput {
  key: string;
  successes: number;
  trials: number;
}

export interface BinaryVariantResult {
  key: string;
  rate: number;
  /** Probability this variant is the best of all variants passed in. */
  pBest: number;
  /** Expected loss from choosing this variant instead of the true best. */
  expectedLoss: number;
  /** 95% credible interval on the rate. */
  credibleInterval: [number, number];
}

const DEFAULT_DRAWS = 100_000;

/**
 * Bayesian analysis for a binary metric (click-through, engaged session).
 * Beta(1,1) prior, Beta(1+successes, 1+failures) posterior per variant;
 * P(best) and expected loss from joint Monte Carlo draws, which handles any
 * number of variants (A/B/n) the same way.
 */
export function analyzeBinaryMetric(
  variants: BinaryVariantInput[],
  options: { draws?: number; rng?: Rng } = {},
): BinaryVariantResult[] {
  if (variants.length < 2) throw new RangeError("analyzeBinaryMetric: need at least 2 variants to compare");

  const draws = options.draws ?? DEFAULT_DRAWS;
  const rng = options.rng ?? createRng();
  const alphas = variants.map((v) => 1 + v.successes);
  const betas = variants.map((v) => 1 + (v.trials - v.successes));

  const bestCount = new Array(variants.length).fill(0);
  const lossSum = new Array(variants.length).fill(0);
  const samplesByVariant: number[][] = variants.map(() => []);

  for (let d = 0; d < draws; d++) {
    const sample = alphas.map((a, i) => sampleBeta(rng, a, betas[i]));
    let bestIdx = 0;
    for (let i = 1; i < sample.length; i++) if (sample[i] > sample[bestIdx]) bestIdx = i;
    bestCount[bestIdx] += 1;
    const bestValue = sample[bestIdx];
    for (let i = 0; i < sample.length; i++) {
      lossSum[i] += bestValue - sample[i];
      samplesByVariant[i].push(sample[i]);
    }
  }

  return variants.map((v, i) => {
    const samples = samplesByVariant[i].sort((a, b) => a - b);
    return {
      key: v.key,
      rate: v.trials > 0 ? v.successes / v.trials : 0,
      pBest: bestCount[i] / draws,
      expectedLoss: lossSum[i] / draws,
      credibleInterval: [samples[Math.floor(0.025 * samples.length)], samples[Math.floor(0.975 * samples.length)]],
    };
  });
}
