import type { PendingBatchReviewFile } from "@editor-extensions/shared";

/**
 * The pre-change content to compare against when the user presses Continue
 * after reviewing a proposal in the editor. Prefers the proposal's own queue
 * entry (the agent route never populates `modifiedFiles`), then the legacy
 * `modifiedFiles` record, and treats a new file as originally empty.
 * Returns `undefined` when no baseline is known.
 */
export function resolveContinueBaseline(
  queued: Pick<PendingBatchReviewFile, "originalContent" | "isNew"> | undefined,
  modifiedFilesOriginal: string | undefined,
): string | undefined {
  return queued?.originalContent ?? modifiedFilesOriginal ?? (queued?.isNew ? "" : undefined);
}

export interface ContinueOutcome {
  responseId: "apply" | "reject";
  /** Content to report: what the user kept on disk, or the declined proposal. */
  content: string;
}

/**
 * Continue accepts whatever the user left on disk. If the file still matches
 * its baseline the user kept nothing, which is a rejection of the proposal.
 */
export function decideContinueOutcome(
  currentText: string,
  baseline: string,
  proposal: string,
): ContinueOutcome {
  const normalize = (s: string) => s.replace(/\r\n/g, "\n").trim();
  return normalize(currentText) !== normalize(baseline)
    ? { responseId: "apply", content: currentText }
    : { responseId: "reject", content: proposal };
}
