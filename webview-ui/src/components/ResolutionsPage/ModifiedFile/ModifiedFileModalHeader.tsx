import React from "react";
import { Button, Flex, FlexItem, Alert } from "@patternfly/react-core";
import { CompressIcon, CheckIcon, CloseIcon, UndoIcon } from "@patternfly/react-icons";
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
  onRejectAll?: () => void;
  onResetAll?: () => void;
  onUserAction?: () => void;
  pendingHunks?: Set<string>;
  acceptedHunks?: Set<string>;
  rejectedHunks?: Set<string>;
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
  onRejectAll,
  onResetAll,
  onUserAction,
  pendingHunks = new Set(),
  acceptedHunks = new Set(),
  rejectedHunks = new Set(),
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
    if (accepted > 0) {
      parts.push(`${accepted} accepted`);
    }
    if (rejected > 0) {
      parts.push(`${rejected} rejected`);
    }
    if (pending > 0) {
      parts.push(`${pending} pending`);
    }

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
        text: "Apply",
        variant: "primary" as const,
        className: "modal-accept-button success-button",
      };
    }

    if (!canSubmit) {
      return {
        text: "Submit Changes",
        variant: "primary" as const,
        className: "modal-accept-button",
      };
    }

    const { accepted, rejected } = hunkSummary;
    if (accepted > 0 && rejected === 0) {
      return {
        text: `Apply ${accepted} Changes`,
        variant: "primary" as const,
        className: "modal-accept-button success-button",
      };
    }

    if (accepted === 0 && rejected > 0) {
      return {
        text: "Submit Rejections",
        variant: "secondary" as const,
        className: "modal-reject-button danger-button",
      };
    }

    return {
      text: `Submit ${accepted + rejected} Decisions`,
      variant: "primary" as const,
      className: "modal-accept-button mixed-button",
    };
  };

  const submitButtonInfo = getSubmitButtonInfo();

  // Get button states for color coding
  const getButtonStates = () => {
    const hasAccepted = acceptedHunks.size > 0;
    const hasRejected = rejectedHunks.size > 0;
    const hasPending = pendingHunks.size > 0;
    const allAccepted = acceptedHunks.size === hunkSummary.total;
    const allRejected = rejectedHunks.size === hunkSummary.total;

    return {
      selectAll: !allAccepted && (hasPending || hasRejected),
      rejectAll: !allRejected && (hasPending || hasAccepted),
      resetAll: hasAccepted || hasRejected,
      apply: hasAccepted || (isSingleHunk && !actionTaken),
      reject: isSingleHunk && !actionTaken,
    };
  };

  const buttonStates = getButtonStates();

  return (
    <div className="modal-custom-header sticky-header">
      <div className="modal-header-content">
        {/* Combined Title and Actions Row */}
        <Flex
          className="modal-title-row"
          justifyContent={{ default: "justifyContentSpaceBetween" }}
          alignItems={{ default: "alignItemsCenter" }}
          gap={{ default: "gapMd" }}
        >
          {/* Title Section */}
          <FlexItem flex={{ default: "flex_1" }} className="modal-title-container">
            <h2 className="modal-title">
              <span className="modal-action-text">
                {isNew ? "Created file:" : "Modified file:"}
              </span>
              <span className="modal-filename">{fileName}</span>
            </h2>
          </FlexItem>

          {/* Action Buttons Section */}
          {actionTaken === null && (
            <FlexItem className="modal-actions-container">
              <Flex
                className="modal-action-buttons"
                justifyContent={{ default: "justifyContentFlexEnd" }}
                alignItems={{ default: "alignItemsCenter" }}
                gap={{ default: "gapSm" }}
              >
                {/* Multi-hunk selection buttons */}
                {!isSingleHunk && (
                  <>
                    {onSelectAll && buttonStates.selectAll && (
                      <Button
                        variant="primary"
                        onClick={() => {
                          onSelectAll();
                          onUserAction?.();
                        }}
                        className="bulk-select-button success-button"
                        size="sm"
                      >
                        Select All
                      </Button>
                    )}
                    {onRejectAll && buttonStates.rejectAll && (
                      <Button
                        variant="danger"
                        onClick={() => {
                          onRejectAll();
                          onUserAction?.();
                        }}
                        className="bulk-reject-button danger-button"
                        size="sm"
                      >
                        Reject All
                      </Button>
                    )}
                    {onResetAll && buttonStates.resetAll && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          onResetAll();
                          onUserAction?.();
                        }}
                        className="bulk-reset-button secondary-button"
                        icon={<UndoIcon />}
                        size="sm"
                      >
                        Reset
                      </Button>
                    )}
                  </>
                )}

                {/* Submit Button */}
                {buttonStates.apply && (
                  <Button
                    variant={submitButtonInfo.variant}
                    onClick={() => {
                      onApply();
                      onUserAction?.();
                    }}
                    isDisabled={!canSubmit}
                    icon={<CheckIcon />}
                    className={submitButtonInfo.className}
                    size="sm"
                  >
                    {submitButtonInfo.text}
                  </Button>
                )}

                {/* Reject Button - only show for single hunks since multi-hunks have Select All/Reject All */}
                {buttonStates.reject && (
                  <Button
                    variant="danger"
                    onClick={() => {
                      onReject();
                      onUserAction?.();
                    }}
                    icon={<CloseIcon />}
                    className="modal-reject-button danger-button"
                    size="sm"
                  >
                    Reject
                  </Button>
                )}
              </Flex>
            </FlexItem>
          )}

          {/* Close button */}
          <FlexItem className="modal-close-container">
            <Button
              variant="plain"
              onClick={onClose}
              icon={<CompressIcon />}
              aria-label="Close modal"
              className="modal-close-button"
              size="sm"
            />
          </FlexItem>
        </Flex>

        {/* Status Alert */}
        {statusMessage && (
          <Alert
            variant={statusMessage.variant}
            title={statusMessage.text}
            isInline
            isPlain
            className="modal-status-alert"
          />
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
