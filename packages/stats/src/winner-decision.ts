import { analyzeBinaryMetric } from "./bayesian/bayesian-binary.js";
import { analyzeContinuousMetric, bootstrapRelativeLiftCI } from "./bayesian/bayesian-bootstrap.js";
import { chiSquareSrmCheck, type SrmCheckResult } from "./frequentist/chi-square-srm.js";
import { holmBonferroniCorrection } from "./frequentist/holm-bonferroni.js";
import { mannWhitneyU } from "./frequentist/mann-whitney.js";
import { welchTTest } from "./frequentist/welch-t.js";
import { createRng, type Rng } from "./math/random.js";

export interface VariantData {
  key: string;
  isControl: boolean;
  /** Configured traffic weight, for the SRM check. */
  weight: number;
  sessions: number;
  clicks: number;
  /** Engagement Score per session. */
  scores: number[];
}

export interface DecisionConfig {
  minSampleSize: number;
  minRunDays: number;
  /** e.g. 0.95 */
  confidenceThreshold: number;
  startedAt: Date;
  now: Date;
  /** After this many days without a winner the test is called inconclusive. */
  maxRunDays?: number;
}

export interface Gate {
  name: string;
  passed: boolean;
  detail: string;
}

export type DecisionStatus = "running" | "winner_found" | "inconclusive";

export interface VariantAnalysis {
  key: string;
  sessions: number;
  meanScore: number;
  pBest: number;
  expectedLoss: number;
  clickRate: number;
  /** Relative lift vs control with a 95% CI (null for the control itself). */
  lift: { estimate: number | null; ci: [number, number] } | null;
  /** Frequentist confirmation vs control, Holm-corrected across variants (null for control). */
  confirmation: { welchP: number; mannWhitneyP: number; adjustedWelchP: number } | null;
}

export interface WinnerDecision {
  status: DecisionStatus;
  winnerKey: string | null;
  srm: SrmCheckResult;
  gates: Gate[];
  variants: VariantAnalysis[];
}

const DAY_MS = 86_400_000;
const EXPECTED_LOSS_LIMIT = 0.01;

/**
 * Applies every gate from docs/PLAN.md section 5. A winner is declared only
 * if ALL pass: no sample-ratio mismatch, minimum sample per variant,
 * minimum run time (a full weekly cycle by default), P(best) >= threshold on
 * the primary metric (Engagement Score), expected loss under 1% of the
 * control's score, and the click-rate guardrail (the winner may not be
 * clearly WORSE than control on clicks).
 */
export function decideWinner(variants: VariantData[], config: DecisionConfig, rng: Rng = createRng()): WinnerDecision {
  const control = variants.find((v) => v.isControl) ?? variants[0];
  const elapsedDays = (config.now.getTime() - config.startedAt.getTime()) / DAY_MS;
  const maxRunDays = config.maxRunDays ?? 60;

  const srm = chiSquareSrmCheck(variants.map((v) => v.sessions), variants.map((v) => v.weight));
  const enoughData = variants.every((v) => v.scores.length >= 2);

  const analysis: VariantAnalysis[] = variants.map((v) => ({
    key: v.key, sessions: v.sessions, meanScore: 0, pBest: 0, expectedLoss: 0,
    clickRate: v.sessions > 0 ? v.clicks / v.sessions : 0, lift: null, confirmation: null,
  }));

  if (enoughData) {
    const continuous = analyzeContinuousMetric(variants.map((v) => ({ key: v.key, values: v.scores })), { rng });
    continuous.forEach((c, i) => {
      analysis[i].meanScore = c.mean;
      analysis[i].pBest = c.pBest;
      analysis[i].expectedLoss = c.expectedLoss;
    });

    const challengers = variants.filter((v) => v !== control);
    const welch = challengers.map((v) => welchTTest(control.scores, v.scores));
    const adjusted = holmBonferroniCorrection(welch.map((w) => w.p));
    challengers.forEach((v, i) => {
      const idx = variants.indexOf(v);
      analysis[idx].lift = {
        estimate: welch[i].relativeLift,
        ci: bootstrapRelativeLiftCI(control.scores, v.scores, { rng, draws: 2000 }),
      };
      analysis[idx].confirmation = {
        welchP: welch[i].p,
        mannWhitneyP: mannWhitneyU(control.scores, v.scores).p,
        adjustedWelchP: adjusted[i],
      };
    });
  }

  const best = [...analysis].sort((a, b) => b.pBest - a.pBest)[0];
  const controlAnalysis = analysis[variants.indexOf(control)];

  // Guardrail: click rate. Fail if the leading variant is clearly worse than control on clicks.
  let guardrailOk = true;
  let guardrailDetail = "Click rate: no evidence the leader is worse than control.";
  if (best.key !== control.key && variants.every((v) => v.sessions > 0)) {
    const clicks = analyzeBinaryMetric(variants.map((v) => ({ key: v.key, successes: v.clicks, trials: v.sessions })), { rng, draws: 20_000 });
    const controlClickBest = clicks.find((c) => c.key === control.key)!.pBest;
    const leaderClickBest = clicks.find((c) => c.key === best.key)!.pBest;
    guardrailOk = !(controlClickBest >= config.confidenceThreshold && leaderClickBest < 0.5);
    if (!guardrailOk) guardrailDetail = `Click rate: control is best on clicks with P=${controlClickBest.toFixed(3)}.`;
  }

  const relLoss = enoughData ? best.expectedLoss / Math.max(1, Math.abs(controlAnalysis.meanScore)) : Infinity;

  const gates: Gate[] = [
    { name: "No sample ratio mismatch", passed: !srm.isMismatched, detail: `chi-square p=${srm.p.toFixed(4)} (fails below 0.001)` },
    { name: "Minimum sample per variant", passed: variants.every((v) => v.sessions >= config.minSampleSize),
      detail: `smallest arm has ${Math.min(...variants.map((v) => v.sessions))} of ${config.minSampleSize} sessions` },
    { name: "Minimum run time", passed: elapsedDays >= config.minRunDays, detail: `${elapsedDays.toFixed(1)} of ${config.minRunDays} days` },
    { name: "Confidence threshold", passed: enoughData && best.pBest >= config.confidenceThreshold,
      detail: `best variant "${best.key}" P(best)=${best.pBest.toFixed(3)}, need ${config.confidenceThreshold}` },
    { name: "Expected loss under 1%", passed: relLoss < EXPECTED_LOSS_LIMIT, detail: `expected loss ${(relLoss * 100).toFixed(2)}% of control score` },
    { name: "Click-rate guardrail", passed: guardrailOk, detail: guardrailDetail },
  ];

  const allPassed = gates.every((g) => g.passed);
  const status: DecisionStatus = allPassed ? "winner_found" : elapsedDays >= maxRunDays ? "inconclusive" : "running";

  return { status, winnerKey: allPassed ? best.key : null, srm, gates, variants: analysis };
}
