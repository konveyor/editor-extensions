import React, { useState } from "react";
import {
  Button,
  Label,
  Flex,
  FlexItem,
  Split,
  SplitItem,
  Popover,
  List,
  ListItem,
  Spinner,
} from "@patternfly/react-core";
import { FileIcon, ExclamationCircleIcon } from "@patternfly/react-icons";
import { useExtensionStore } from "../../../store/store";
import "./batchReviewFooter.css";

/**
 * Compact footer bar that shows pending file changes
 * Integrates with PatternFly Chatbot footer design
 */
export const BatchReviewFooter: React.FC = () => {
  const pendingFiles = useExtensionStore((state) => state.pendingBatchReview || []);
  const isProcessing = useExtensionStore((state) => state.isProcessingQueuedMessages);
  const isBatchOperationInProgress = useExtensionStore((state) => state.isBatchOperationInProgress);
  const [isApplying, setIsApplying] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  // Don't render if no pending files
  if (pendingFiles.length === 0) {
    return null;
  }

  // Reset local loading states when processing completes
  React.useEffect(() => {
    if (!isProcessing) {
      setIsApplying(false);
      setIsRejecting(false);
    }
  }, [isProcessing]);

  const handleApplyAll = () => {
    console.log("[BatchReviewFooter] Apply All clicked, files:", pendingFiles.length);
    setIsApplying(true);
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
    console.log("[BatchReviewFooter] BATCH_APPLY_ALL message sent");
  };

  const handleRejectAll = () => {
    console.log("[BatchReviewFooter] Reject All clicked, files:", pendingFiles.length);
    setIsRejecting(true);
    window.vscode.postMessage({
      type: "BATCH_REJECT_ALL",
      payload: {
        files: pendingFiles.map((f) => ({
          messageToken: f.messageToken,
          path: f.path,
        })),
      },
    });
    console.log("[BatchReviewFooter] BATCH_REJECT_ALL message sent");
  };

  // Popover content showing file list
  const fileListPopover = (
    <div style={{ maxWidth: "400px", maxHeight: "300px", overflow: "auto" }}>
      <p style={{ marginBottom: "0.5rem", fontWeight: 500 }}>
        Pending changes ({pendingFiles.length} files)
      </p>
      <List isPlain isBordered>
        {pendingFiles.map((file) => (
          <ListItem key={file.messageToken}>
            <Flex
              alignItems={{ default: "alignItemsCenter" }}
              spaceItems={{ default: "spaceItemsXs" }}
            >
              <FlexItem>
                <FileIcon style={{ fontSize: "0.875rem" }} />
              </FlexItem>
              <FlexItem style={{ fontSize: "0.875rem" }}>
                <strong>{file.path.replace(/\\/g, "/").split("/").pop() || file.path}</strong>
              </FlexItem>
              <FlexItem>
                {file.isNew && (
                  <Label color="green" isCompact>
                    New
                  </Label>
                )}
                {file.isDeleted && (
                  <Label color="red" isCompact>
                    Deleted
                  </Label>
                )}
              </FlexItem>
            </Flex>
          </ListItem>
        ))}
      </List>
    </div>
  );

  return (
    <>
      <div className="batch-review-footer">
        <div className="batch-review-footer-content">
          <Split hasGutter>
            {/* Left side - Status indicator */}
            <SplitItem>
              <Flex
                alignItems={{ default: "alignItemsCenter" }}
                spaceItems={{ default: "spaceItemsSm" }}
              >
                <FlexItem>
                  <ExclamationCircleIcon color="var(--vscode-notificationsWarningIcon-foreground, #b98412)" />
                </FlexItem>
                <FlexItem>
                  <span className="batch-review-footer-text">
                    <strong>{pendingFiles.length}</strong> file{pendingFiles.length > 1 ? "s" : ""}{" "}
                    {isApplying ? "applying..." : isRejecting ? "rejecting..." : "ready for review"}
                  </span>
                </FlexItem>
                <FlexItem>
                  <Popover
                    aria-label="File list popover"
                    position="top"
                    bodyContent={fileListPopover}
                    showClose={false}
                  >
                    <Button variant="link" isInline style={{ padding: 0 }}>
                      View list
                    </Button>
                  </Popover>
                </FlexItem>
              </Flex>
            </SplitItem>

            {/* Right side - Actions */}
            <SplitItem isFilled>
              <Flex
                justifyContent={{ default: "justifyContentFlexEnd" }}
                spaceItems={{ default: "spaceItemsSm" }}
              >
                <FlexItem>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={handleRejectAll}
                    isDisabled={isApplying || isRejecting || isBatchOperationInProgress}
                    icon={isRejecting ? <Spinner size="sm" /> : undefined}
                  >
                    {isRejecting ? "Rejecting..." : "Reject All"}
                  </Button>
                </FlexItem>
                <FlexItem>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleApplyAll}
                    isDisabled={isApplying || isRejecting || isBatchOperationInProgress}
                    icon={isApplying ? <Spinner size="sm" /> : undefined}
                  >
                    {isApplying ? "Applying..." : `Apply All (${pendingFiles.length})`}
                  </Button>
                </FlexItem>
              </Flex>
            </SplitItem>
          </Split>
        </div>
      </div>
    </>
  );
};

export default BatchReviewFooter;
