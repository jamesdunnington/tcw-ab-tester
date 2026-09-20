import { useState } from "react";
import { api } from "../lib/api.js";
import type { TestOutcome } from "../lib/types.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { Icon } from "./Icon.js";

interface Props {
  testId: string;
  isElement: boolean;
  outcome: TestOutcome;
  onDone: (message: string) => void;
}

/** Archived page tests: what the page ended up with, and a way back to the original. */
export function OutcomePanel({ testId, isElement, outcome, onDone }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/tests/${testId}/restore-original`);
      setConfirming(false);
      onDone(isElement ? "The permanent change was removed. The page shows its own content again." : "The original was restored. WordPress kept the version it replaced as a revision.");
    } catch (err) {
      setConfirming(false);
      setError(err instanceof Error ? `Could not restore the original (${err.message}).` : "Could not restore the original.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="outcome-heading">
      <h2 id="outcome-heading">Outcome</h2>
      <p>
        On {new Date(outcome.decidedAt).toLocaleDateString()} the page took on <strong>{outcome.chosenLabel}</strong>
        {outcome.restoredAt ? `, and the original was ${isElement ? "put back" : "restored"} on ${new Date(outcome.restoredAt).toLocaleDateString()}.` : "."}
      </p>
      {error && <div className="banner banner-danger" role="alert"><Icon name="alert" /><div>{error}</div></div>}
      {outcome.restorable && (
        <>
          <p className="muted small">
            {isElement
              ? "The winning edits are a permanent change on the page. Removing it shows the page's own content again."
              : "The hub kept the original's title, content and excerpt before it was replaced. Template, featured image and SEO fields are not saved, so they stay as they are now."}
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)} disabled={busy}>{isElement ? "Remove the permanent change" : "Restore the original"}</button>
        </>
      )}
      {outcome.restoredAt && (
        <>
          <button type="button" className="btn btn-secondary" disabled aria-describedby="restored-note">{isElement ? "Permanent change removed" : "Original restored"}</button>
          <p id="restored-note" className="muted small">
            Done on {new Date(outcome.restoredAt).toLocaleString()}. It can only be done once. To go back further, use the page's revisions in WordPress.
          </p>
        </>
      )}
      {!outcome.restorable && !outcome.restoredAt && (
        <p className="muted small">There is nothing to restore: the original was kept, or the hub has no saved copy of it.</p>
      )}
      <ConfirmDialog open={confirming} title={isElement ? "Remove the permanent change?" : "Restore the original?"} confirmLabel={isElement ? "Remove the change" : "Restore the original"} busy={busy} onConfirm={restore} onCancel={() => setConfirming(false)}>
        {isElement ? (
          <p>The winning edits stop being applied and visitors see the page as it is in WordPress. You can apply them again from the library.</p>
        ) : (
          <p>The page's title, content and excerpt go back to how they were before this test. WordPress saves the current version as a revision first, so you can undo this from the page's revisions.</p>
        )}
      </ConfirmDialog>
    </section>
  );
}
