import React from "react";
import { Button, Flex, FlexItem, Alert } from "@patternfly/react-core";
import { CompressIcon, CheckIcon, CloseIcon } from "@patternfly/react-icons";
import "./ModifiedFileModalHeader.css";

interface HunkSummary {
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
}

interface ModifiedFileModalHeaderProps {
  isNew: boolean;
  fileName: string;
  isSingleHunk: boolean;
  actionTaken: "applied" | "rejected" | null;
  hunkSummary: HunkSummary;
  canSubmit: boolean;
  onClose: () => void;
  onApply: (selectedContent?: string) => void;
  onReject: () => void;
  onSelectAll?: () => void;
}

export const ModifiedFileModalHeader: React.FC<ModifiedFileModalHeaderProps> = ({
  isNew,
  fileName,
  isSingleHunk,
  actionTaken,
  hunkSummary,
  canSubmit,
  onClose,
  onApply,
  onReject,
  onSelectAll,
}) => {
  // Generate status message for multi-hunk scenarios
  const getStatusMessage = () => {
    if (isSingleHunk || actionTaken !== null) {
      return null;
    }

    const { total, accepted, rejected, pending } = hunkSummary;

    if (pending === total) {
      return {
        text: `${total} changes pending review`,
        variant: "warning" as const,
      };
    }

    const parts: string[] = [];
    if (accepted > 0) parts.push(`${accepted} accepted`);
    if (rejected > 0) parts.push(`${rejected} rejected`);
    if (pending > 0) parts.push(`${pending} pending`);

    return {
      text: parts.join(", "),
      variant: "info" as const,
    };
  };

  const statusMessage = getStatusMessage();

  // Generate submit button text and variant
  const getSubmitButtonInfo = () => {
    if (isSingleHunk) {
      return {
        text: "Apply Changes",
        variant: "primary" as const,
      };
    }

    if (!canSubmit) {
      return {
        text: "Submit Changes",
        variant: "primary" as const,
      };
    }

    const { accepted, rejected } = hunkSummary;
    if (accepted > 0 && rejected === 0) {
      return {
        text: `Apply ${accepted} Changes`,
        variant: "primary" as const,
      };
    }

    if (accepted === 0 && rejected > 0) {
      return {
        text: "Submit Rejections",
        variant: "secondary" as const,
      };
    }

    return {
      text: `Submit ${accepted + rejected} Decisions`,
      variant: "primary" as const,
    };
  };

  const submitButtonInfo = getSubmitButtonInfo();

  return (
    <div className="modal-custom-header sticky-header">
      <div className="modal-header-content">
        {/* Title Row */}
        <Flex
          className="modal-title-row"
          justifyContent={{ default: "justifyContentSpaceBetween" }}
          alignItems={{ default: "alignItemsCenter" }}
        >
          <FlexItem flex={{ default: "flex_1" }} className="modal-title-container">
            <h2 className="modal-title">
              <span className="modal-action-text">
                {isNew ? "Created file:" : "Modified file:"}
              </span>
              <span className="modal-filename">{fileName}</span>
            </h2>
          </FlexItem>

          {/* Close button */}
          <FlexItem className="modal-close-container">
            <Button
              variant="plain"
              onClick={onClose}
              icon={<CompressIcon />}
              aria-label="Close modal"
            />
          </FlexItem>
        </Flex>

        {/* Status Alert */}
        {statusMessage && (
          <Alert variant={statusMessage.variant} title={statusMessage.text} isInline isPlain />
        )}

        {/* Action Row */}
        {actionTaken === null && (
          <Flex
            className="modal-action-row"
            justifyContent={{ default: "justifyContentCenter" }}
            alignItems={{ default: "alignItemsCenter" }}
            gap={{ default: "gapMd" }}
          >
            {/* Multi-hunk selection buttons */}
            {!isSingleHunk && onSelectAll && (
              <>
                <FlexItem>
                  <Button
                    variant="primary"
                    onClick={onSelectAll}
                    isDisabled={hunkSummary.accepted === hunkSummary.total}
                    style={{ minWidth: "100px" }}
                  >
                    Select All
                  </Button>
                </FlexItem>
                <FlexItem>
                  <Button variant="danger" onClick={onReject} style={{ minWidth: "100px" }}>
                    Reject All
                  </Button>
                </FlexItem>
              </>
            )}

            {/* Submit Button */}
            <FlexItem>
              <Button
                variant={submitButtonInfo.variant}
                onClick={() => {
                  onApply();
                }}
                isDisabled={!canSubmit}
                icon={<CheckIcon />}
                style={{ minWidth: "120px" }}
              >
                {submitButtonInfo.text}
              </Button>
            </FlexItem>

            {/* Reject Button - only show for single hunks since multi-hunks have Select All/Reject All */}
            {isSingleHunk && (
              <FlexItem>
                <Button
                  variant="danger"
                  onClick={onReject}
                  icon={<CloseIcon />}
                  style={{ minWidth: "100px" }}
                >
                  Reject Changes
                </Button>
              </FlexItem>
            )}
          </Flex>
        )}

        {/* Completion Status */}
        {actionTaken && (
          <Alert
            variant={actionTaken === "applied" ? "success" : "danger"}
            title={
              actionTaken === "applied" ? "Changes Applied Successfully" : "All Changes Rejected"
            }
            isInline
            isPlain
          />
        )}
      </div>
    </div>
  );
};
