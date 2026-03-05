import React, { useState } from "react";
import { useExtensionStore } from "../../store/store";
import "./CompactBatchReview.css";

export const CompactBatchReview: React.FC = () => {
  const pendingFiles = useExtensionStore((state) => state.pendingBatchReview || []);
  const activeDecorators = useExtensionStore((state) => state.activeDecorators);
  const isBatchOperationInProgress = useExtensionStore((state) => state.isBatchOperationInProgress);
  const setBatchOperationInProgress = useExtensionStore(
    (state) => state.setBatchOperationInProgress,
  );

  const [isExpanded, setIsExpanded] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [processingFiles, setProcessingFiles] = useState<Set<string>>(new Set());
  const [viewingInEditor, setViewingInEditor] = useState<string | null>(null);
  const [hasBeenManuallyCollapsed, setHasBeenManuallyCollapsed] = useState(false);

  // Auto-expand when new files arrive (unless user manually collapsed)
  React.useEffect(() => {
    if (pendingFiles.length > 0 && !isExpanded && !hasBeenManuallyCollapsed) {
      setIsExpanded(true);
    }
  }, [pendingFiles.length, isExpanded, hasBeenManuallyCollapsed]);

  // Auto-adjust index when files are removed
  React.useEffect(() => {
    if (currentIndex >= pendingFiles.length && pendingFiles.length > 0) {
      setCurrentIndex(Math.max(0, pendingFiles.length - 1));
    }
    if (pendingFiles.length === 0) {
      setIsExpanded(false);
      setProcessingFiles(new Set());
      setHasBeenManuallyCollapsed(false);
    }
  }, [pendingFiles.length, currentIndex]);

  // Clear processing state for removed/errored files
  React.useEffect(() => {
    if (processingFiles.size > 0) {
      const currentTokens = new Set(pendingFiles.map((f) => f.messageToken));
      const toRemove: string[] = [];
      processingFiles.forEach((token) => {
        if (!currentTokens.has(token)) {
          toRemove.push(token);
        } else {
          const file = pendingFiles.find((f) => f.messageToken === token);
          if (file?.hasError) {
            toRemove.push(token);
          }
        }
      });
      if (toRemove.length > 0) {
        setProcessingFiles((prev) => {
          const next = new Set(prev);
          toRemove.forEach((t) => next.delete(t));
          return next;
        });
      }
    }
  }, [pendingFiles, processingFiles]);

  React.useEffect(() => {
    if (!isBatchOperationInProgress) {
      setProcessingFiles(new Set());
    }
  }, [isBatchOperationInProgress]);

  if (pendingFiles.length === 0) {
    return null;
  }

  const currentFile = pendingFiles[currentIndex];
  if (!currentFile) {
    return null;
  }

  const currentFileName = currentFile.path.split("/").pop() || currentFile.path;
  const noChanges = !currentFile.diff || currentFile.diff.trim() === "";
  const isProcessing = processingFiles.has(currentFile.messageToken) || isBatchOperationInProgress;
  const hasActiveDecorators = Boolean(
    activeDecorators &&
      typeof activeDecorators === "object" &&
      currentFile.messageToken in activeDecorators &&
      activeDecorators[currentFile.messageToken] === currentFile.path,
  );
  const isViewingDiff = viewingInEditor === currentFile.messageToken || hasActiveDecorators;
  const busy = isProcessing || isBatchOperationInProgress;

  const adjustIndexAfterRemove = () => {
    if (currentIndex === pendingFiles.length - 1 && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleApplyAll = () => {
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
  };

  const handleRejectAll = () => {
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
  };

  const handleAccept = () => {
    setProcessingFiles((prev) => new Set(prev).add(currentFile.messageToken));
    setViewingInEditor(null);
    adjustIndexAfterRemove();
    window.vscode.postMessage({
      type: "FILE_RESPONSE",
      payload: {
        responseId: "apply",
        messageToken: currentFile.messageToken,
        path: currentFile.path,
        content: currentFile.content,
      },
    });
  };

  const handleReject = () => {
    setProcessingFiles((prev) => new Set(prev).add(currentFile.messageToken));
    setViewingInEditor(null);
    adjustIndexAfterRemove();
    window.vscode.postMessage({
      type: "FILE_RESPONSE",
      payload: {
        responseId: "reject",
        messageToken: currentFile.messageToken,
        path: currentFile.path,
      },
    });
  };

  const handleContinue = () => {
    setProcessingFiles((prev) => new Set(prev).add(currentFile.messageToken));
    setViewingInEditor(null);
    adjustIndexAfterRemove();
    window.vscode.postMessage({
      type: "CONTINUE_WITH_FILE_STATE",
      payload: {
        messageToken: currentFile.messageToken,
        path: currentFile.path,
        content: currentFile.content,
      },
    });
  };

  const handleReviewInEditor = () => {
    if (noChanges || currentFile.isNew) {
      return;
    }
    setViewingInEditor(currentFile.messageToken);
    window.vscode.postMessage({
      type: "SHOW_DIFF_WITH_DECORATORS",
      payload: {
        path: currentFile.path,
        content: currentFile.content,
        diff: currentFile.diff,
        messageToken: currentFile.messageToken,
      },
    });
  };

  // ─── Collapsed ────────────────────────────────────────────────────

  if (!isExpanded) {
    return (
      <div className="cbr cbr--collapsed cbr--highlight">
        <button
          className="cbr__expand-btn"
          onClick={() => {
            setIsExpanded(true);
            setHasBeenManuallyCollapsed(false);
          }}
          aria-label="Expand batch review"
        >
          ▲
        </button>
        <span className="cbr__summary">
          <strong>{pendingFiles.length}</strong> file{pendingFiles.length > 1 ? "s" : ""} ready for
          review
        </span>
        <span className="cbr__bulk-actions">
          <button className="cbr__btn cbr__btn--primary" onClick={handleApplyAll} disabled={busy}>
            Apply All
          </button>
          <button className="cbr__btn cbr__btn--danger" onClick={handleRejectAll} disabled={busy}>
            Reject All
          </button>
        </span>
      </div>
    );
  }

  // ─── Expanded ─────────────────────────────────────────────────────

  const fileLabel = currentFile.isNew
    ? "new"
    : currentFile.isDeleted
      ? "deleted"
      : currentFile.hasError
        ? "error"
        : noChanges
          ? "unchanged"
          : "modified";

  return (
    <div className="cbr cbr--expanded">
      {/* Header */}
      <div className="cbr__header">
        <button
          className="cbr__expand-btn"
          onClick={() => {
            setIsExpanded(false);
            setHasBeenManuallyCollapsed(true);
          }}
          aria-label="Collapse"
        >
          ▼
        </button>
        <span className="cbr__title">
          {currentIndex + 1} / {pendingFiles.length}
        </span>
        {pendingFiles.length > 1 && (
          <span className="cbr__bulk-actions">
            <button
              className="cbr__btn cbr__btn--primary"
              onClick={handleApplyAll}
              disabled={busy || hasActiveDecorators}
            >
              Apply All ({pendingFiles.length})
            </button>
            <button
              className="cbr__btn cbr__btn--danger"
              onClick={handleRejectAll}
              disabled={busy || hasActiveDecorators}
            >
              Reject All
            </button>
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="cbr__progress">
        <div
          className="cbr__progress-bar"
          style={{ width: `${((currentIndex + 1) / pendingFiles.length) * 100}%` }}
        />
      </div>

      {/* Current file info */}
      <div className="cbr__file-info">
        <span className="cbr__file-icon">
          {currentFile.isNew ? "+" : currentFile.isDeleted ? "−" : "~"}
        </span>
        <span className="cbr__file-name" title={currentFile.path}>
          {currentFileName}
        </span>
        <span className={`cbr__file-label cbr__file-label--${fileLabel}`}>{fileLabel}</span>
      </div>

      {/* Actions */}
      {(() => {
        console.log("[CBR] Review button conditions:", {
          isViewingDiff,
          isProcessing,
          noChanges,
          isNew: currentFile.isNew,
          showReview: !isViewingDiff && !isProcessing && !noChanges && !currentFile.isNew,
          fileLabel,
          path: currentFile.path,
        });
        return null;
      })()}
      <div className="cbr__actions">
        <button
          className="cbr__btn cbr__btn--nav"
          onClick={() => setCurrentIndex(currentIndex - 1)}
          disabled={currentIndex === 0 || isProcessing}
        >
          ←
        </button>

        {isViewingDiff || isProcessing ? (
          <span className="cbr__status">
            {isProcessing
              ? "Processing..."
              : hasActiveDecorators
                ? "Reviewing in editor"
                : "Changes resolved"}
          </span>
        ) : noChanges ? (
          <span className="cbr__status">No changes detected</span>
        ) : null}

        {!isViewingDiff && !isProcessing && !noChanges && !currentFile.isNew && (
          <button className="cbr__btn cbr__btn--review" onClick={handleReviewInEditor}>
            📝 Review
          </button>
        )}

        {isViewingDiff && !isProcessing ? (
          <button
            className="cbr__btn cbr__btn--primary"
            onClick={handleContinue}
            disabled={hasActiveDecorators}
          >
            Continue
          </button>
        ) : noChanges ? (
          <button
            className="cbr__btn cbr__btn--primary"
            onClick={handleContinue}
            disabled={isProcessing}
          >
            Skip
          </button>
        ) : (
          <>
            <button
              className="cbr__btn cbr__btn--danger"
              onClick={handleReject}
              disabled={isProcessing}
            >
              Reject
            </button>
            <button
              className="cbr__btn cbr__btn--primary"
              onClick={handleAccept}
              disabled={isProcessing}
            >
              Accept
            </button>
          </>
        )}

        <button
          className="cbr__btn cbr__btn--nav"
          onClick={() => setCurrentIndex(currentIndex + 1)}
          disabled={currentIndex === pendingFiles.length - 1 || isProcessing}
        >
          →
        </button>
      </div>
    </div>
  );
};

export default CompactBatchReview;
