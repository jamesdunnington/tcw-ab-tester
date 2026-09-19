/**
 * Engagement Score (0-100) per session (docs/PLAN.md section 5): active time,
 * scroll depth, key sections seen for >= 1s, hover intent, click.
 *
 * The plan's five weights are used as written. A session whose tracker sent no
 * section data (sectionsTotal = 0: an older cached tracker, or a page with no
 * headings) is scored on the other four, rescaled to 100 - the same relative
 * proportions the plan gives them - so it is neither punished for missing
 * data nor able to outscore a session that had it.
 * Weights are overridable per test.
 */

export interface EngagementWeights {
  activeTime: number;
  scrollDepth: number;
  /** Share of the page's key sections seen for >= 1s. */
  sections: number;
  hover: number;
  click: number;
}

export type EngagementPreset = "cta" | "content" | "landing";

export const ENGAGEMENT_PRESETS: Record<EngagementPreset, EngagementWeights> = {
  cta: { activeTime: 15, scrollDepth: 10, sections: 10, hover: 15, click: 50 },
  content: { activeTime: 35, scrollDepth: 25, sections: 20, hover: 5, click: 15 },
  landing: { activeTime: 25, scrollDepth: 20, sections: 15, hover: 10, click: 30 },
};

export interface SessionSignals {
  activeMs: number;
  /** 0-100 */
  maxScrollPct: number;
  /** Any hover of >= 500ms on a goal element. */
  hovered: boolean;
  clicked: boolean;
  rageClicks: number;
  /** Key sections seen, and how many the tracker observed. Omitted or 0 total = no section data. */
  sectionsSeen?: number;
  sectionsTotal?: number;
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

  const total = signals.sectionsTotal ?? 0;
  const hasSections = total > 0;
  const sectionRatio = hasSections ? Math.min(1, Math.max(0, (signals.sectionsSeen ?? 0) / total)) : 0;

  let raw =
    weights.activeTime * timeRatio +
    weights.scrollDepth * scrollRatio +
    weights.sections * sectionRatio +
    weights.hover * (signals.hovered ? 1 : 0) +
    weights.click * (signals.clicked ? 1 : 0);
  if (!hasSections) {
    const rest = 100 - weights.sections;
    raw = rest > 0 ? (raw * 100) / rest : 0;
  }

  return Math.max(0, Math.min(100, raw - RAGE_CLICK_PENALTY * signals.rageClicks));
}
