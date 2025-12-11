import React, { useState } from "react";
import { Button, Label, Flex, FlexItem, Progress, ProgressSize } from "@patternfly/react-core";
import { FileIcon, AngleUpIcon, AngleDownIcon } from "@patternfly/react-icons";
import { useExtensionStore } from "../../../store/store";
import "./batchReviewExpandable.css";

/**
 * Expandable footer panel for batch file review
 * Expands upward to show compact file-by-file review interface
 */
export const BatchReviewExpandable: React.FC = () => {
  const pendingFiles = useExtensionStore((state) => state.pendingBatchReview || []);
  const activeDecorators = useExtensionStore((state) => state.activeDecorators);
  const isGlobalProcessing = useExtensionStore((state) => state.isBatchOperationInProgress);
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

  // Auto-adjust index when files are removed from the list
  React.useEffect(() => {
    // If current index is beyond the list (file was removed), go to previous index
    if (currentIndex >= pendingFiles.length && pendingFiles.length > 0) {
      setCurrentIndex(Math.max(0, pendingFiles.length - 1));
    }
    // If list is now empty, collapse the footer and reset manual collapse flag
    if (pendingFiles.length === 0) {
      setIsExpanded(false);
      setProcessingFiles(new Set()); // Clear processing state
      setHasBeenManuallyCollapsed(false); // Reset for next batch
    }
  }, [pendingFiles.length, currentIndex]);

  // Debug: Log decorator state
  React.useEffect(() => {
    if (pendingFiles.length > 0) {
      console.log("[BatchReviewExpandable] State update", {
        currentIndex,
        pendingFilesCount: pendingFiles.length,
        currentFile: pendingFiles[currentIndex]?.path,
        currentToken: pendingFiles[currentIndex]?.messageToken,
        activeDecorators,
      });
    }
  }, [currentIndex, activeDecorators, pendingFiles]);

  // Clear processing state for files no longer in pendingFiles or files with errors
  React.useEffect(() => {
    if (processingFiles.size > 0) {
      const currentPendingTokens = new Set(pendingFiles.map((file) => file.messageToken));
      const tokensToRemove: string[] = [];

      // Find tokens that should be cleared from processing state
      processingFiles.forEach((token) => {
        // Clear if file is no longer in pendingFiles (success case)
        if (!currentPendingTokens.has(token)) {
          tokensToRemove.push(token);
        } else {
          // Clear if file has an error (to allow retry)
          const file = pendingFiles.find((f) => f.messageToken === token);
          if (file?.hasError) {
            tokensToRemove.push(token);
          }
        }
      });

      // Remove tokens that are no longer relevant or have errors
      if (tokensToRemove.length > 0) {
        console.log(
          "[BatchReviewExpandable] Clearing processing state for removed/errored files:",
          tokensToRemove,
        );
        setProcessingFiles((prev) => {
          const newSet = new Set(prev);
          tokensToRemove.forEach((token) => newSet.delete(token));
          return newSet;
        });
      }
    }
  }, [pendingFiles, processingFiles]);

  // Don't render if no pending files
  if (pendingFiles.length === 0) {
    return null;
  }

  const currentFile = pendingFiles[currentIndex];

  // Safety check - currentFile might be undefined if index is out of bounds
  if (!currentFile) {
    return null;
  }

  const currentFileName = currentFile.path.split("/").pop() || currentFile.path;

  // Diff is already cleaned by cleanDiff() in handleModifiedFile.ts
  // which returns "" for line-ending-only or no meaningful changes
  const shouldShowNoChangesNeeded = !currentFile.diff || currentFile.diff.trim() === "";

  // Check if processing: either this specific file OR global batch processing
  const isProcessing = processingFiles.has(currentFile.messageToken) || isGlobalProcessing;

  // Check if decorators are ACTIVE for this file (not just opened, but has unresolved decorators)
  const hasActiveDecorators = Boolean(
    activeDecorators &&
      typeof activeDecorators === "object" &&
      currentFile.messageToken in activeDecorators &&
      activeDecorators[currentFile.messageToken] === currentFile.path,
  );

  // Track if we've opened the file (for UI state), but decorators might be resolved
  const isViewingDiff = viewingInEditor === currentFile.messageToken || hasActiveDecorators;

  // Debug logs
  console.log("[BatchReviewExpandable] Current state", {
    isViewingDiff,
    isProcessing,
    viewingInEditor,
    currentIndex,
    pendingFilesCount: pendingFiles.length,
    currentFileName,
    messageToken: currentFile.messageToken,
    processingFilesSet: Array.from(processingFiles),
  });

  if (isViewingDiff) {
    console.log("[BatchReviewExpandable] Decorator active for current file", {
      messageToken: currentFile.messageToken,
      path: currentFile.path,
      decoratorValue: activeDecorators[currentFile.messageToken],
    });
  }

  const handleReviewInEditor = () => {
    console.log("[BatchReviewExpandable] Opening file with decorators", {
      path: currentFile.path,
      messageToken: currentFile.messageToken,
      shouldShowNoChangesNeeded,
      isNew: currentFile.isNew,
    });

    // Don't try to show diff if there are no changes
    if (shouldShowNoChangesNeeded) {
      console.warn("[BatchReviewExpandable] Cannot review file with empty diff");
      return;
    }

    // For new files, we should show a message that they can't be reviewed with decorators
    if (currentFile.isNew) {
      console.warn("[BatchReviewExpandable] New files cannot be reviewed with decorators");
      // Don't mark as viewing in editor since we can't show decorators
      // User should use Accept/Reject buttons instead
      return;
    }

    // Optimistically mark as viewing to immediately switch UI
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

  const handleContinue = () => {
    console.log("[BatchReviewExpandable] Continue clicked", {
      path: currentFile.path,
      messageToken: currentFile.messageToken,
    });

    // Mark as processing to prevent further interactions
    setProcessingFiles((prev) => new Set(prev).add(currentFile.messageToken));
    setViewingInEditor(null); // Clear viewing state

    // If we're at the last file, proactively adjust the index
    if (currentIndex === pendingFiles.length - 1 && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }

    // Check current file state and apply/reject based on changes
    // Backend will remove from pendingBatchReview, which will trigger re-render
    window.vscode.postMessage({
      type: "CONTINUE_WITH_FILE_STATE",
      payload: {
        messageToken: currentFile.messageToken,
        path: currentFile.path,
        content: currentFile.content,
      },
    });
  };

  const handleAccept = () => {
    console.log("[BatchReviewExpandable] Accept clicked", {
      path: currentFile.path,
      messageToken: currentFile.messageToken,
    });

    // Mark as processing to prevent further interactions
    setProcessingFiles((prev) => new Set(prev).add(currentFile.messageToken));
    setViewingInEditor(null); // Clear viewing state

    // If we're at the last file, proactively adjust the index
    if (currentIndex === pendingFiles.length - 1 && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }

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
    console.log("[BatchReviewExpandable] Reject clicked", {
      path: currentFile.path,
      messageToken: currentFile.messageToken,
    });

    // Mark as processing to prevent further interactions
    setProcessingFiles((prev) => new Set(prev).add(currentFile.messageToken));
    setViewingInEditor(null); // Clear viewing state

    // If we're at the last file, proactively adjust the index
    if (currentIndex === pendingFiles.length - 1 && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }

    window.vscode.postMessage({
      type: "FILE_RESPONSE",
      payload: {
        responseId: "reject",
        messageToken: currentFile.messageToken,
        path: currentFile.path,
      },
    });
  };

  const handleNext = () => {
    if (currentIndex < pendingFiles.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleApplyAll = () => {
    // Set batch operation in progress
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
    setIsExpanded(false);
  };

  const handleRejectAll = () => {
    // Set batch operation in progress
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
    setIsExpanded(false);
  };

  // Collapsed state - compact indicator with quick actions
  if (!isExpanded) {
    return (
      <div className="batch-review-expandable collapsed batch-review-highlight">
        <Flex
          alignItems={{ default: "alignItemsCenter" }}
          spaceItems={{ default: "spaceItemsMd" }}
          className="batch-review-collapsed-content"
        >
          {/* Expand button - now just an icon */}
          <FlexItem>
            <Button
              variant="plain"
              onClick={() => {
                setIsExpanded(true);
                setHasBeenManuallyCollapsed(false);
              }}
              aria-label="Expand batch review"
              icon={<AngleUpIcon />}
            />
          </FlexItem>

          {/* File info */}
          <FlexItem flex={{ default: "flex_1" }}>
            <Flex
              alignItems={{ default: "alignItemsCenter" }}
              spaceItems={{ default: "spaceItemsSm" }}
            >
              <FlexItem>
                <FileIcon />
              </FlexItem>
              <FlexItem>
                <strong>{pendingFiles.length}</strong> file{pendingFiles.length > 1 ? "s" : ""}{" "}
                ready for review
                {pendingFiles[currentIndex] && (
                  <span style={{ marginLeft: "8px", opacity: 0.8, fontSize: "0.875em" }}>
                    • {pendingFiles[currentIndex].path.split("/").pop()}
                  </span>
                )}
              </FlexItem>
            </Flex>
          </FlexItem>

          {/* Action buttons on the right */}
          <FlexItem>
            <Button
              variant="primary"
              size="sm"
              onClick={handleApplyAll}
              isDisabled={isGlobalProcessing}
            >
              Apply All ({pendingFiles.length})
            </Button>
          </FlexItem>
          <FlexItem>
            <Button
              variant="link"
              size="sm"
              onClick={handleRejectAll}
              isDisabled={isGlobalProcessing}
              isDanger
            >
              Reject All
            </Button>
          </FlexItem>
        </Flex>
      </div>
    );
  }

  // Expanded state - file review interface
  return (
    <div className="batch-review-expandable expanded">
      {/* Header with collapse button and bulk actions */}
      <div className="batch-review-expandable-header">
        <Flex alignItems={{ default: "alignItemsCenter" }} spaceItems={{ default: "spaceItemsMd" }}>
          {/* Collapse button on the left for consistency */}
          <FlexItem>
            <Button
              variant="plain"
              onClick={() => {
                setIsExpanded(false);
                setHasBeenManuallyCollapsed(true);
              }}
              aria-label="Collapse"
              icon={<AngleDownIcon />}
            />
          </FlexItem>

          {/* File info takes remaining space */}
          <FlexItem flex={{ default: "flex_1" }}>
            <span className="batch-review-title">
              <FileIcon style={{ marginRight: "8px" }} />
              Reviewing: {currentFile.path.split("/").pop()} ({currentIndex + 1} of{" "}
              {pendingFiles.length})
            </span>
          </FlexItem>

          {/* Bulk actions on the right */}
          {pendingFiles.length > 1 && (
            <>
              <FlexItem>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleApplyAll}
                  isDisabled={isProcessing || hasActiveDecorators}
                >
                  Apply All ({pendingFiles.length})
                </Button>
              </FlexItem>
              <FlexItem>
                <Button
                  variant="link"
                  size="sm"
                  onClick={handleRejectAll}
                  isDisabled={isProcessing || hasActiveDecorators}
                  isDanger
                >
                  Reject All
                </Button>
              </FlexItem>
            </>
          )}
        </Flex>
        <Progress
          value={((currentIndex + 1) / pendingFiles.length) * 100}
          title={`Reviewing file ${currentIndex + 1} of ${pendingFiles.length}`}
          size={ProgressSize.sm}
          style={{ marginTop: "0.5rem" }}
        />
      </div>

      {/* Current file info */}
      <div className="batch-review-current-file">
        <Flex
          direction={{ default: "row" }}
          alignItems={{ default: "alignItemsCenter" }}
          spaceItems={{ default: "spaceItemsSm" }}
        >
          <FlexItem>
            <FileIcon />
          </FlexItem>
          <FlexItem flex={{ default: "flex_1" }} className="batch-review-filename-compact">
            <strong>{currentFileName}</strong>
          </FlexItem>
          <FlexItem>
            {currentFile.isNew && (
              <Label color="green" isCompact>
                New
              </Label>
            )}
            {currentFile.isDeleted && (
              <Label color="red" isCompact>
                Deleted
              </Label>
            )}
            {currentFile.hasError && (
              <Label color="orange" isCompact>
                Error - Retry Available
              </Label>
            )}
          </FlexItem>
        </Flex>
      </div>

      {/* Actions - horizontal layout for minimal space */}
      <div className="batch-review-actions">
        {/* Show special UI for new files */}
        {currentFile.isNew ? (
          <Flex
            spaceItems={{ default: "spaceItemsXs" }}
            alignItems={{ default: "alignItemsCenter" }}
          >
            <FlexItem>
              <Button
                variant="control"
                onClick={handlePrevious}
                isDisabled={currentIndex === 0 || isProcessing}
                size="sm"
              >
                ←
              </Button>
            </FlexItem>
            <FlexItem flex={{ default: "flex_1" }}>
              <span
                style={{
                  color: "#6a6e73",
                  textAlign: "center",
                  display: "block",
                }}
              >
                ✨ This is a new file
              </span>
            </FlexItem>
            <FlexItem>
              <Button variant="danger" onClick={handleReject} size="sm" isDisabled={isProcessing}>
                Reject
              </Button>
            </FlexItem>
            <FlexItem>
              <Button variant="primary" onClick={handleAccept} size="sm" isDisabled={isProcessing}>
                Accept
              </Button>
            </FlexItem>
            <FlexItem>
              <Button
                variant="control"
                onClick={handleNext}
                isDisabled={currentIndex === pendingFiles.length - 1 || isProcessing}
                size="sm"
              >
                →
              </Button>
            </FlexItem>
          </Flex>
        ) : /* Show special UI for empty diffs (no changes) */
        shouldShowNoChangesNeeded ? (
          <Flex
            spaceItems={{ default: "spaceItemsSm" }}
            alignItems={{ default: "alignItemsCenter" }}
            justifyContent={{ default: "justifyContentCenter" }}
          >
            <FlexItem>
              <Button
                variant="control"
                onClick={handlePrevious}
                isDisabled={currentIndex === 0 || isProcessing}
                size="sm"
              >
                ←
              </Button>
            </FlexItem>
            <FlexItem>
              <span
                style={{
                  color: "#6a6e73",
                  fontStyle: "italic",
                }}
              >
                ℹ️ No changes detected in this file
              </span>
            </FlexItem>
            <FlexItem>
              <Button
                variant="primary"
                onClick={handleContinue}
                size="sm"
                isDisabled={isProcessing}
              >
                Continue
              </Button>
            </FlexItem>
            <FlexItem>
              <Button
                variant="control"
                onClick={handleNext}
                isDisabled={currentIndex === pendingFiles.length - 1 || isProcessing}
                size="sm"
              >
                →
              </Button>
            </FlexItem>
          </Flex>
        ) : /* Show different UI when reviewing in editor with decorators OR processing */
        isViewingDiff || isProcessing ? (
          <Flex
            justifyContent={{ default: "justifyContentCenter" }}
            alignItems={{ default: "alignItemsCenter" }}
            spaceItems={{ default: "spaceItemsSm" }}
          >
            <FlexItem>
              <span className="batch-review-decorator-status">
                {isProcessing
                  ? "⏳ Processing changes..."
                  : hasActiveDecorators
                    ? "📝 Reviewing in editor - use CodeLens to accept/reject changes, then save"
                    : "✓ All changes resolved. Press continue to resume."}
              </span>
            </FlexItem>
            <FlexItem>
              <Button
                variant="primary"
                onClick={handleContinue}
                size="sm"
                isDisabled={isProcessing || hasActiveDecorators}
              >
                Continue
              </Button>
            </FlexItem>
          </Flex>
        ) : (
          <Flex
            spaceItems={{ default: "spaceItemsSm" }}
            alignItems={{ default: "alignItemsCenter" }}
            justifyContent={{ default: "justifyContentCenter" }}
          >
            <FlexItem>
              <Button
                variant="control"
                onClick={handlePrevious}
                isDisabled={currentIndex === 0 || isProcessing}
                size="sm"
              >
                ←
              </Button>
            </FlexItem>

            {/* Review in Editor button */}
            <FlexItem>
              <Button
                variant="secondary"
                onClick={handleReviewInEditor}
                size="sm"
                isDisabled={isProcessing || shouldShowNoChangesNeeded || currentFile.isNew}
                title={
                  shouldShowNoChangesNeeded
                    ? "No changes to review"
                    : currentFile.isNew
                      ? "New files cannot be reviewed with decorators - use Accept/Reject buttons"
                      : undefined
                }
              >
                {isProcessing ? "⏳ Processing..." : "📝 Review in Editor"}
              </Button>
            </FlexItem>

            {/* Reject button */}
            <FlexItem>
              <Button variant="danger" onClick={handleReject} size="sm" isDisabled={isProcessing}>
                Reject
              </Button>
            </FlexItem>

            {/* Accept button */}
            <FlexItem>
              <Button variant="primary" onClick={handleAccept} size="sm" isDisabled={isProcessing}>
                Accept
              </Button>
            </FlexItem>

            <FlexItem>
              <Button
                variant="control"
                onClick={handleNext}
                isDisabled={currentIndex === pendingFiles.length - 1 || isProcessing}
                size="sm"
              >
                →
              </Button>
            </FlexItem>
          </Flex>
        )}
      </div>
    </div>
  );
};

export default BatchReviewExpandable;
