import { and, eq, isNull } from "drizzle-orm";
import { tests, users, variants, type Database } from "@tcw/db";
import type { WinnerDecision } from "@tcw/stats";

/** The slice of nodemailer's transport the worker uses, so tests can pass a fake. */
export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown>;
}

export interface NotifyConfig {
  /** Sender address. */
  from: string;
  /** Comma-separated recipients; empty means every hub user. */
  recipients: string;
  /** Public dashboard URL, for the link in the email. */
  hubUrl: string;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export interface WinnerEmailInput {
  testName: string;
  winnerLabel: string;
  /** 0-1 */
  pBest: number | null;
  /** Fraction, e.g. 0.12 for +12%. */
  lift: number | null;
  url: string;
}

/** Pure: what the "winner found" email says. Test names come from WordPress titles, so the HTML is escaped. */
export function buildWinnerEmail(i: WinnerEmailInput): { subject: string; text: string; html: string } {
  const facts: string[] = [];
  if (i.pBest !== null) facts.push(`${(i.pBest * 100).toFixed(1)}% chance it is best`);
  if (i.lift !== null) facts.push(`${i.lift >= 0 ? "+" : ""}${(i.lift * 100).toFixed(1)}% engagement vs the original`);
  const detail = facts.length ? ` (${facts.join(", ")})` : "";
  const subject = `A/B test has a winner: ${i.testName}`;
  const text = `"${i.testName}" has a winner: ${i.winnerLabel}${detail}.\n\nEvery condition for calling it is met. Nothing changes on the site until you decide whether to keep the original or apply the winner, and whether to delete the redundant copy.\n\nReview and decide: ${i.url}\n`;
  const html = `<p><strong>${escapeHtml(i.testName)}</strong> has a winner: <strong>${escapeHtml(i.winnerLabel)}</strong>${escapeHtml(detail)}.</p><p>Every condition for calling it is met. Nothing changes on the site until you decide whether to keep the original or apply the winner, and whether to delete the redundant copy.</p><p><a href="${escapeHtml(i.url)}">Review and decide</a></p>`;
  return { subject, text, html };
}

export type NotifyOutcome = "sent" | "already_sent" | "not_configured" | "no_recipients" | "failed";

/**
 * Sends the "winner found" email once per test. The claim (winner_notified_at) is taken BEFORE sending,
 * atomically, so two workers or two hourly runs cannot both send; a failed send releases the claim so the
 * next hourly run retries. With no mail transport configured nothing is claimed, so turning email on later
 * still notifies tests that already have a winner.
 */
export async function notifyWinnerFound(
  deps: { db: Database; transport: MailTransport | null; config: NotifyConfig },
  testId: string,
  decision: Pick<WinnerDecision, "winnerKey" | "variants">,
): Promise<NotifyOutcome> {
  const { db, transport, config } = deps;
  if (!transport) return "not_configured";

  const [claimed] = await db
    .update(tests)
    .set({ winnerNotifiedAt: new Date() })
    .where(and(eq(tests.id, testId), isNull(tests.winnerNotifiedAt)))
    .returning({ name: tests.name });
  if (!claimed) return "already_sent";

  const release = () => db.update(tests).set({ winnerNotifiedAt: null }).where(eq(tests.id, testId));
  try {
    const list = config.recipients.split(",").map((s) => s.trim()).filter(Boolean);
    const to = list.length > 0 ? list : (await db.select({ email: users.email }).from(users)).map((u) => u.email);
    if (to.length === 0) {
      await release();
      return "no_recipients";
    }

    const winner = decision.variants.find((v) => v.key === decision.winnerKey);
    const [variant] = await db.select({ label: variants.label }).from(variants).where(and(eq(variants.testId, testId), eq(variants.key, decision.winnerKey ?? "")));
    const mail = buildWinnerEmail({
      testName: claimed.name,
      winnerLabel: variant?.label ?? `Variant ${decision.winnerKey}`,
      pBest: typeof winner?.pBest === "number" ? winner.pBest : null,
      lift: typeof winner?.lift?.estimate === "number" ? winner.lift.estimate : null,
      url: `${config.hubUrl.replace(/\/$/, "")}/tests/${testId}`,
    });
    await transport.sendMail({ from: config.from, to: to.join(", "), ...mail });
    return "sent";
  } catch (err) {
    await release().catch(() => undefined);
    // eslint-disable-next-line no-console
    console.error(`[worker] winner email for test ${testId} failed, will retry next run:`, err);
    return "failed";
  }
}
