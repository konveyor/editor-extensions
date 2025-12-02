import React, { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  CardFooter,
  Button,
  List,
  ListItem,
  Title,
  Label,
  Flex,
  FlexItem,
  Spinner,
} from "@patternfly/react-core";
import { CheckCircleIcon } from "@patternfly/react-icons";
import { useExtensionStore } from "../../../store/store";
import "./batchReviewSummary.css";

export const BatchReviewSummary: React.FC = () => {
  const pendingFiles = useExtensionStore((state) => state.pendingBatchReview || []);
  // Use batch-specific processing state to prevent premature resets
  const isBatchProcessing = useExtensionStore((state) => state.isBatchOperationInProgress);
  const setBatchOperationInProgress = useExtensionStore(
    (state) => state.setBatchOperationInProgress,
  );
  const [isApplying, setIsApplying] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  if (pendingFiles.length === 0) {
    return null;
  }

  // Reset local loading states when batch processing completes
  React.useEffect(() => {
    if (!isBatchProcessing) {
      setIsApplying(false);
      setIsRejecting(false);
    }
  }, [isBatchProcessing]);

  const handleApplyAll = () => {
    console.log("[BatchReviewSummary] Apply All clicked, files:", pendingFiles.length);
    setIsApplying(true);
    // Set batch operation in progress
    setBatchOperationInProgress(true);
    // Send message to apply all files
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
    console.log("[BatchReviewSummary] BATCH_APPLY_ALL message sent");
  };

  const handleRejectAll = () => {
    console.log("[BatchReviewSummary] Reject All clicked, files:", pendingFiles.length);
    setIsRejecting(true);
    // Set batch operation in progress
    setBatchOperationInProgress(true);
    // Send message to reject all files
    window.vscode.postMessage({
      type: "BATCH_REJECT_ALL",
      payload: {
        files: pendingFiles.map((f) => ({
          messageToken: f.messageToken,
          path: f.path,
        })),
      },
    });
    console.log("[BatchReviewSummary] BATCH_REJECT_ALL message sent");
  };

  return (
    <div className="batch-review-summary">
      <Card className="batch-review-summary-card">
        <CardHeader>
          <CardTitle>
            <Flex alignItems={{ default: "alignItemsCenter" }}>
              <FlexItem>
                <Title headingLevel="h3" size="lg">
                  📦 Changes Ready for Review
                </Title>
              </FlexItem>
              <FlexItem>
                <Label color="blue" isCompact>
                  {pendingFiles.length} files
                </Label>
              </FlexItem>
            </Flex>
          </CardTitle>
        </CardHeader>
        <CardBody>
          <p style={{ marginBottom: "1rem", color: "#6a6e73" }}>
            All file changes have been prepared. Review each change or apply/reject all at once.
          </p>
          <List isPlain isBordered>
            {pendingFiles.slice(0, 8).map((file) => (
              <ListItem key={file.messageToken}>
                <Flex alignItems={{ default: "alignItemsCenter" }}>
                  <FlexItem>
                    <CheckCircleIcon color="green" />
                  </FlexItem>
                  <FlexItem>
                    <strong>{file.path}</strong>
                  </FlexItem>
                  <FlexItem>
                    {file.isNew && <Label color="green">New</Label>}
                    {file.isDeleted && <Label color="red">Deleted</Label>}
                  </FlexItem>
                </Flex>
              </ListItem>
            ))}
            {pendingFiles.length > 8 && (
              <ListItem>
                <em style={{ color: "#6a6e73" }}>... and {pendingFiles.length - 8} more files</em>
              </ListItem>
            )}
          </List>
        </CardBody>
        <CardFooter>
          <Flex spaceItems={{ default: "spaceItemsSm" }}>
            <FlexItem>
              <Button
                variant="secondary"
                onClick={handleApplyAll}
                isDisabled={isApplying || isRejecting || isBatchProcessing}
                icon={isApplying ? <Spinner size="sm" /> : undefined}
              >
                {isApplying ? "Applying..." : `Apply All (${pendingFiles.length})`}
              </Button>
            </FlexItem>
            <FlexItem>
              <Button
                variant="link"
                onClick={handleRejectAll}
                isDisabled={isApplying || isRejecting || isBatchProcessing}
                icon={isRejecting ? <Spinner size="sm" /> : undefined}
              >
                {isRejecting ? "Rejecting..." : "Reject All"}
              </Button>
            </FlexItem>
          </Flex>
        </CardFooter>
      </Card>
    </div>
  );
};

export default BatchReviewSummary;
