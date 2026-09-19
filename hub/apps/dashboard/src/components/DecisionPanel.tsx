import { useState, type FormEvent } from "react";
import { api } from "../lib/api.js";
import type { Variant } from "../lib/types.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { Icon } from "./Icon.js";

interface Props {
  testId: string;
  /** Element tests have no copy to delete; the winning edits become a permanent change instead. */
  testType: "page" | "element";
  variants: Variant[];
  recommendedKey: string | null;
  onDone: () => void;
}

/** The two questions from docs/PLAN.md section 6: which version to keep, and whether to delete the redundant copy. */
export function DecisionPanel({ testId, testType, variants, recommendedKey, onDone }: Props) {
  const [chosen, setChosen] = useState(recommendedKey ?? variants.find((v) => v.isControl)?.key ?? variants[0].key);
  const [deleteRedundant, setDeleteRedundant] = useState(false);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);

  const chosenVariant = variants.find((v) => v.key === chosen)!;
  const isElement = testType === "element";
  const overriding = recommendedKey !== null && chosen !== recommendedKey;

  function review(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (overriding && !reason.trim()) {
      setReasonError("Please say why you are not following the recommendation.");
      return;
    }
    setReasonError(null);
    setConfirming(true);
  }

  async function submit() {
    setBusy(true);
    try {
      await api.post(`/api/tests/${testId}/decision`, { chosenVariantKey: chosen, deleteRedundant: isElement ? false : deleteRedundant, reason: reason.trim() || undefined });
      setConfirming(false);
      onDone();
    } catch (err) {
      setConfirming(false);
      setError(err instanceof Error ? err.message : "Could not finish the test.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={review} noValidate>
      <h2 style={{ marginTop: 0 }}>Decide what to keep</h2>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>Which version should the page end up with?</legend>
        {variants.map((v) => (
          <label key={v.id} className="choice">
            <input type="radio" name="chosen" value={v.key} checked={chosen === v.key} onChange={() => setChosen(v.key)} />
            <span>
              {v.isControl ? "Keep the original" : `Use ${v.label}`}
              {v.key === recommendedKey && <span className="badge badge-success" style={{ marginLeft: 8 }}><Icon name="trophy" />Recommended</span>}
            </span>
          </label>
        ))}
      </fieldset>

      {overriding && (
        <div className="field">
          <label htmlFor="reason">Why not the recommended version?</label>
          <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={reasonError ? true : undefined} aria-describedby={reasonError ? "reason-error" : "reason-hint"} />
          {reasonError ? <span id="reason-error" className="error-text" role="alert">{reasonError}</span> : <span id="reason-hint" className="hint">Saved with the decision so the record explains itself later.</span>}
        </div>
      )}

      {!isElement && <div className="field">
        <label className="choice">
          <input type="checkbox" checked={deleteRedundant} onChange={(e) => setDeleteRedundant(e.target.checked)} />
          <span>Delete the redundant test copy from WordPress<br /><span className="hint">Unchecked, it is kept as a hidden draft. The test results are kept either way.</span></span>
        </label>
      </div>}

      {error && <div className="banner banner-danger" role="alert"><Icon name="alert" /><div><strong>Nothing was deleted.</strong> {error}</div></div>}

      <button type="submit" className="btn">Review decision</button>

      <ConfirmDialog open={confirming} title="Confirm your decision" confirmLabel={!isElement && deleteRedundant ? "Apply and delete copy" : "Apply decision"} danger={!isElement && deleteRedundant} busy={busy} onConfirm={submit} onCancel={() => setConfirming(false)}>
        <ul>
          <li>{chosenVariant.isControl ? "The original page stays exactly as it is." : isElement ? `The edits from “${chosenVariant.label}” become a permanent change on the page, shown to every visitor with no tracking.` : `The original page's content is replaced with “${chosenVariant.label}”. WordPress saves a revision of the current content first.`}</li>
          {!isElement && <li>{deleteRedundant ? <strong>The test copy is permanently deleted from WordPress. This cannot be undone.</strong> : "The test copy is kept as a hidden draft."}</li>}
          <li>The test stops splitting visitors and moves to the archive.</li>
        </ul>
      </ConfirmDialog>
    </form>
  );
}
