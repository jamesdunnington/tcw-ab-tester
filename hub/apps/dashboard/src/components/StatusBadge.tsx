import type { TestStatus } from "../lib/types.js";
import { Icon } from "./Icon.js";

const MAP: Record<TestStatus, { label: string; tone: string; icon: Parameters<typeof Icon>[0]["name"] }> = {
  draft: { label: "Draft", tone: "neutral", icon: "clock" },
  qa: { label: "In QA", tone: "info", icon: "clock" },
  running: { label: "Running", tone: "info", icon: "play" },
  winner_found: { label: "Winner ready", tone: "success", icon: "trophy" },
  inconclusive: { label: "Inconclusive", tone: "warn", icon: "alert" },
  awaiting_decision: { label: "Awaiting decision", tone: "warn", icon: "alert" },
  finalising: { label: "Finalising", tone: "info", icon: "refresh" },
  archived: { label: "Archived", tone: "neutral", icon: "archive" },
};

/** Status is always icon + text + color, never color alone. */
export function StatusBadge({ status }: { status: TestStatus }) {
  const s = MAP[status];
  return (
    <span className={`badge badge-${s.tone}`}>
      <Icon name={s.icon} />
      {s.label}
    </span>
  );
}
