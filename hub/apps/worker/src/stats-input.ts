import { computeEngagementScore, ENGAGEMENT_PRESETS, type EngagementPreset, type VariantData } from "@tcw/stats";

export interface PageviewRow {
  variantId: string;
  sessionId: string;
  activeMs: number;
  maxScrollPct: string | number;
  clicked: boolean;
  rageClicks: number;
}

export interface VariantRow {
  id: string;
  key: string;
  isControl: boolean;
  trafficWeight: number;
}

/**
 * Pure mapping from stored rollups to the shape @tcw/stats consumes. Kept
 * free of DB/env imports so it is unit-testable (see __tests__/stats-input.test.ts).
 * Pages get the "landing" weights, posts the "content" weights.
 */
export function buildVariantData(
  variantRows: VariantRow[],
  pageviewRows: PageviewRow[],
  hoveredSessions: Set<string>,
  wordCount: number,
  postType: "post" | "page",
): VariantData[] {
  const preset: EngagementPreset = postType === "page" ? "landing" : "content";
  const weights = ENGAGEMENT_PRESETS[preset];

  return variantRows.map((v) => {
    const rows = pageviewRows.filter((p) => p.variantId === v.id);
    return {
      key: v.key,
      isControl: v.isControl,
      weight: v.trafficWeight,
      sessions: rows.length,
      clicks: rows.filter((r) => r.clicked).length,
      scores: rows.map((r) =>
        computeEngagementScore(
          {
            activeMs: r.activeMs,
            maxScrollPct: Number(r.maxScrollPct),
            hovered: hoveredSessions.has(r.sessionId),
            clicked: r.clicked,
            rageClicks: r.rageClicks,
          },
          weights,
          wordCount,
        ),
      ),
    };
  });
}
