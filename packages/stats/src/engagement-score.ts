/**
 * Engagement Score (0-100) per session, from the signals the tracker
 * actually collects today: active time, scroll depth, hover intent, click.
 *
 * docs/PLAN.md section 5 specifies a fifth component (share of key sections
 * seen for >= 1s). That needs per-section visibility tracking, which arrives
 * with the heatmap work in phase 4, so it is intentionally not scored yet.
 * The presets below are the plan's weights with that component removed and
 * the remainder rescaled to 100, keeping the plan's relative proportions.
 * Weights are overridable per test.
 */

export interface EngagementWeights {
  activeTime: number;
  scrollDepth: number;
  hover: number;
  click: number;
}

export type EngagementPreset = "cta" | "content" | "landing";

export const ENGAGEMENT_PRESETS: Record<EngagementPreset, EngagementWeights> = {
  cta: { activeTime: 17, scrollDepth: 11, hover: 17, click: 55 },
  content: { activeTime: 44, scrollDepth: 31, hover: 6, click: 19 },
  landing: { activeTime: 29, scrollDepth: 24, hover: 12, click: 35 },
};

export interface SessionSignals {
  activeMs: number;
  /** 0-100 */
  maxScrollPct: number;
  /** Any hover of >= 500ms on a goal element. */
  hovered: boolean;
  clicked: boolean;
  rageClicks: number;
}

const WORDS_PER_MINUTE = 230;
const QUICK_BOUNCE_MS = 5000;
const RAGE_CLICK_PENALTY = 5;

/** Expected time to read a page, in ms, from its word count (floor of 10s so tiny pages are not instantly "fully read"). */
export function expectedReadMs(wordCount: number): number {
  return Math.max(10_000, (wordCount / WORDS_PER_MINUTE) * 60_000);
}

/**
 * A quick bounce (under 5s active AND no scroll AND no click) scores 0.
 * Each rage click subtracts 5 points. The result is clamped to [0, 100].
 */
export function computeEngagementScore(signals: SessionSignals, weights: EngagementWeights, wordCount: number): number {
  const noInteraction = signals.maxScrollPct <= 0 && !signals.clicked;
  if (signals.activeMs < QUICK_BOUNCE_MS && noInteraction) return 0;

  const timeRatio = Math.min(1, signals.activeMs / expectedReadMs(wordCount));
  const scrollRatio = Math.min(1, Math.max(0, signals.maxScrollPct / 100));

  const raw =
    weights.activeTime * timeRatio +
    weights.scrollDepth * scrollRatio +
    weights.hover * (signals.hovered ? 1 : 0) +
    weights.click * (signals.clicked ? 1 : 0);

  return Math.max(0, Math.min(100, raw - RAGE_CLICK_PENALTY * signals.rageClicks));
}
