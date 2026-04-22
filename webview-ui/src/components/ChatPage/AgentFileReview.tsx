import React, { useState, useCallback, useMemo } from "react";
import type { PendingBatchReviewFile } from "@editor-extensions/shared";
import { filterLineEndingOnlyChanges } from "@editor-extensions/shared";
import { useExtensionStore } from "../../store/store";
import "./AgentFileReview.css";

interface DiffStats {
  additions: number;
  deletions: number;
}

function computeDiffStats(diff: string): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
    }
  }
  return { additions, deletions };
}

function stripWorkspaceRoot(filePath: string, workspaceRoot: string): string {
  let root = (workspaceRoot || "").replace(/\\/g, "/");
  if (root.startsWith("file:///")) {
    root = root.slice("file://".length);
  } else if (root.startsWith("file:")) {
    root = root.slice("file:".length);
  }
  root = root.replace(/\/$/, "");
  const normalized = filePath.replace(/\\/g, "/");
  if (root && normalized.startsWith(root)) {
    return normalized.slice(root.length + 1) || normalized.split("/").pop() || filePath;
  }
  return normalized;
}

interface ParsedDiffLine {
  type: "addition" | "deletion" | "context" | "hunk-header";
  content: string;
}

function parseDiffLines(diff: string): ParsedDiffLine[] {
  const raw = diff.split("\n");
  const filtered = filterLineEndingOnlyChanges(raw);
  const lines: ParsedDiffLine[] = [];
  let inHunk = false;

  for (const line of filtered) {
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      lines.push({ type: "hunk-header", content: line });
      continue;
    }
    if (!inHunk) {
      continue;
    }
    if (line.startsWith("+")) {
      lines.push({ type: "addition", content: line.slice(1) });
    } else if (line.startsWith("-")) {
      lines.push({ type: "deletion", content: line.slice(1) });
    } else {
      lines.push({ type: "context", content: line.startsWith(" ") ? line.slice(1) : line });
    }
  }
  return lines;
}

const InlineDiff: React.FC<{ diff: string }> = React.memo(({ diff }) => {
  const lines = useMemo(() => parseDiffLines(diff), [diff]);

  if (lines.length === 0) {
    return <div className="afr-diff-empty">No meaningful changes</div>;
  }

  return (
    <div className="afr-diff">
      <pre className="afr-diff__pre">
        {lines.map((line, i) => (
          <div key={i} className={`afr-diff__line afr-diff__line--${line.type}`}>
            <span className="afr-diff__gutter">
              {line.type === "addition"
                ? "+"
                : line.type === "deletion"
                  ? "−"
                  : line.type === "hunk-header"
                    ? "@@"
                    : " "}
            </span>
            <span className="afr-diff__content">
              {line.type === "hunk-header" ? line.content : line.content}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
});
InlineDiff.displayName = "InlineDiff";

interface FileItemProps {
  file: PendingBatchReviewFile;
  displayPath: string;
  isExpanded: boolean;
  isProcessing: boolean;
  isBusy: boolean;
  onToggle: () => void;
  onAccept: () => void;
  onReject: () => void;
  onReviewInEditor: () => void;
}

const FileItem: React.FC<FileItemProps> = React.memo(
  ({
    file,
    displayPath,
    isExpanded,
    isProcessing: _isProcessing,
    isBusy,
    onToggle,
    onAccept,
    onReject,
    onReviewInEditor,
  }) => {
    const noChanges = !file.diff || file.diff.trim() === "";
    const stats = useMemo(
      () => (file.diff ? computeDiffStats(file.diff) : { additions: 0, deletions: 0 }),
      [file.diff],
    );

    const fileLabel = file.isNew
      ? "new"
      : file.isDeleted
        ? "deleted"
        : file.hasError
          ? "error"
          : noChanges
            ? "unchanged"
            : "modified";

    return (
      <div className={`afr-file ${isExpanded ? "afr-file--expanded" : ""}`}>
        <button className="afr-file__header" onClick={onToggle} disabled={noChanges && !file.isNew}>
          <span className={`afr-file__chevron ${isExpanded ? "afr-file__chevron--open" : ""}`}>
            ▶
          </span>
          <span className="afr-file__icon">{file.isNew ? "+" : file.isDeleted ? "−" : "~"}</span>
          <span className="afr-file__path" title={file.path}>
            {displayPath}
          </span>
          <span className={`afr-file__badge afr-file__badge--${fileLabel}`}>{fileLabel}</span>
          {!noChanges && !file.isNew && !file.isDeleted && (
            <span className="afr-file__stats">
              {stats.additions > 0 && (
                <span className="afr-file__stat afr-file__stat--add">+{stats.additions}</span>
              )}
              {stats.deletions > 0 && (
                <span className="afr-file__stat afr-file__stat--del">−{stats.deletions}</span>
              )}
            </span>
          )}
        </button>

        {isExpanded && (
          <div className="afr-file__body">
            {!noChanges && <InlineDiff diff={file.diff} />}
            {file.isNew && noChanges && (
              <div className="afr-diff-empty">New file (no diff available)</div>
            )}
            <div className="afr-file__actions">
              {!noChanges && !file.isNew && (
                <button
                  className="afr-btn afr-btn--ghost"
                  onClick={onReviewInEditor}
                  disabled={isBusy}
                  title="Open side-by-side diff in the editor"
                >
                  Open in Editor
                </button>
              )}
              <div className="afr-file__actions-right">
                <button className="afr-btn afr-btn--reject" onClick={onReject} disabled={isBusy}>
                  Reject
                </button>
                <button className="afr-btn afr-btn--accept" onClick={onAccept} disabled={isBusy}>
                  Accept
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
);
FileItem.displayName = "FileItem";

export const AgentFileReview: React.FC = () => {
  const pendingFiles = useExtensionStore((s) => s.pendingBatchReview || []);
  const isBatchOperationInProgress = useExtensionStore((s) => s.isBatchOperationInProgress);
  const workspaceRoot = useExtensionStore((s) => s.workspaceRoot);
  const setBatchOperationInProgress = useExtensionStore((s) => s.setBatchOperationInProgress);

  const [expandedTokens, setExpandedTokens] = useState<Set<string>>(new Set());
  const [processingTokens, setProcessingTokens] = useState<Set<string>>(new Set());

  const busy = isBatchOperationInProgress;

  const totalStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const f of pendingFiles) {
      if (f.diff) {
        const s = computeDiffStats(f.diff);
        additions += s.additions;
        deletions += s.deletions;
      }
    }
    return { additions, deletions };
  }, [pendingFiles]);

  const toggleExpand = useCallback((token: string) => {
    setExpandedTokens((prev) => {
      const next = new Set(prev);
      if (next.has(token)) {
        next.delete(token);
      } else {
        next.add(token);
      }
      return next;
    });
  }, []);

  const handleAccept = useCallback((file: PendingBatchReviewFile) => {
    setProcessingTokens((prev) => new Set(prev).add(file.messageToken));
    window.vscode.postMessage({
      type: "FILE_RESPONSE",
      payload: {
        responseId: "apply",
        messageToken: file.messageToken,
        path: file.path,
        content: file.content,
      },
    });
  }, []);

  const handleReject = useCallback((file: PendingBatchReviewFile) => {
    setProcessingTokens((prev) => new Set(prev).add(file.messageToken));
    window.vscode.postMessage({
      type: "FILE_RESPONSE",
      payload: {
        responseId: "reject",
        messageToken: file.messageToken,
        path: file.path,
      },
    });
  }, []);

  const handleApplyAll = useCallback(() => {
    setBatchOperationInProgress(true);
    window.vscode.postMessage({
      type: "BATCH_APPLY_ALL",
      payload: {
        files: pendingFiles.map((f) => ({
          messageToken: f.messageToken,
          path: f.path,
          content: f.content,
        })),
      },
    });
  }, [pendingFiles, setBatchOperationInProgress]);

  const handleRejectAll = useCallback(() => {
    setBatchOperationInProgress(true);
    window.vscode.postMessage({
      type: "BATCH_REJECT_ALL",
      payload: {
        files: pendingFiles.map((f) => ({
          messageToken: f.messageToken,
          path: f.path,
        })),
      },
    });
  }, [pendingFiles, setBatchOperationInProgress]);

  const handleReviewInEditor = useCallback((file: PendingBatchReviewFile) => {
    if (!file.diff || file.diff.trim() === "" || file.isNew) {
      return;
    }
    window.vscode.postMessage({
      type: "SHOW_DIFF_WITH_DECORATORS",
      payload: {
        path: file.path,
        content: file.content,
        diff: file.diff,
        messageToken: file.messageToken,
      },
    });
  }, []);

  // Clean up processing tokens when files are removed
  React.useEffect(() => {
    if (processingTokens.size > 0) {
      const currentTokens = new Set(pendingFiles.map((f) => f.messageToken));
      const stale = [...processingTokens].filter((t) => !currentTokens.has(t));
      if (stale.length > 0) {
        setProcessingTokens((prev) => {
          const next = new Set(prev);
          stale.forEach((t) => next.delete(t));
          return next;
        });
      }
    }
  }, [pendingFiles, processingTokens]);

  React.useEffect(() => {
    if (!isBatchOperationInProgress) {
      setProcessingTokens(new Set());
    }
  }, [isBatchOperationInProgress]);

  React.useEffect(() => {
    if (pendingFiles.length === 0) {
      setBatchOperationInProgress(false);
    }
  }, [pendingFiles.length, setBatchOperationInProgress]);

  // Auto-expand the first file when the review appears
  React.useEffect(() => {
    if (pendingFiles.length > 0 && expandedTokens.size === 0) {
      setExpandedTokens(new Set([pendingFiles[0].messageToken]));
    }
  }, [pendingFiles.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (pendingFiles.length === 0) {
    return null;
  }

  return (
    <div className="afr">
      <div className="afr__header">
        <div className="afr__header-left">
          <span className="afr__title">
            {pendingFiles.length} file{pendingFiles.length !== 1 ? "s" : ""} changed
          </span>
          <span className="afr__total-stats">
            {totalStats.additions > 0 && (
              <span className="afr-file__stat afr-file__stat--add">+{totalStats.additions}</span>
            )}
            {totalStats.deletions > 0 && (
              <span className="afr-file__stat afr-file__stat--del">−{totalStats.deletions}</span>
            )}
          </span>
        </div>
        <div className="afr__header-actions">
          <button className="afr-btn afr-btn--reject-all" onClick={handleRejectAll} disabled={busy}>
            Reject All
          </button>
          <button className="afr-btn afr-btn--accept-all" onClick={handleApplyAll} disabled={busy}>
            Accept All
          </button>
        </div>
      </div>

      <div className="afr__list">
        {pendingFiles.map((file) => (
          <FileItem
            key={file.messageToken}
            file={file}
            displayPath={stripWorkspaceRoot(file.path, workspaceRoot)}
            isExpanded={expandedTokens.has(file.messageToken)}
            isProcessing={processingTokens.has(file.messageToken)}
            isBusy={busy || processingTokens.has(file.messageToken)}
            onToggle={() => toggleExpand(file.messageToken)}
            onAccept={() => handleAccept(file)}
            onReject={() => handleReject(file)}
            onReviewInEditor={() => handleReviewInEditor(file)}
          />
        ))}
      </div>
    </div>
  );
};

export default AgentFileReview;
