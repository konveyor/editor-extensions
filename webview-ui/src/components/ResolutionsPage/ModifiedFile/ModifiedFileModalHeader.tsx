import React from "react";
import { Button, Flex, FlexItem } from "@patternfly/react-core";
import {
  CompressIcon,
  CheckIcon,
  CloseIcon,
  PlusCircleIcon,
  MinusCircleIcon,
} from "@patternfly/react-icons";
import "./ModifiedFileModalHeader.css";

interface ParsedHunk {
  id: string;
  header: string;
  changes: string[];
}

interface ModifiedFileModalHeaderProps {
  isNew: boolean;
  fileName: string;
  isSingleHunk: boolean;
  actionTaken: "applied" | "rejected" | null;
  parsedHunks: ParsedHunk[];
  hunkStates: Record<string, boolean>;
  onClose: () => void;
  onApply: () => void;
  onReject: () => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
}

export const ModifiedFileModalHeader: React.FC<ModifiedFileModalHeaderProps> = ({
  isNew,
  fileName,
  isSingleHunk,
  actionTaken,
  parsedHunks,
  hunkStates,
  onClose,
  onApply,
  onReject,
  onSelectAll,
  onDeselectAll,
}) => {
  // Calculate hunk selection state for multi-hunk scenarios
  const getHunkSelectionState = () => {
    if (isSingleHunk) {
      return null;
    }

    const selectedHunks = parsedHunks.filter((hunk) => hunkStates[hunk.id]);
    const totalHunks = parsedHunks.length;
    const selectedCount = selectedHunks.length;

    if (selectedCount === 0) {
      return { 
        type: "none", 
        text: "Reject All", 
        description: "No changes selected - will reject all changes",
        isAcceptAllMode: false
      };
    } else if (selectedCount === totalHunks) {
      return {
        type: "all",
        text: "Accept All Changes",
        description: `Apply all ${totalHunks} changes`,
        isAcceptAllMode: true
      };
    } else {
      return {
        type: "partial",
        text: `Accept ${selectedCount} Changes`,
        description: `Apply ${selectedCount} of ${totalHunks} changes`,
        isAcceptAllMode: false
      };
    }
  };

  const selectionState = getHunkSelectionState();
  
  // Determine if Accept button should be disabled
  const isAcceptDisabled = !isSingleHunk && selectionState?.type === "none";

  return (
    <div className="modal-custom-header sticky-header">
      <div className="modal-header-content">
        {/* Title Row - Always at top */}
        <Flex 
          className="modal-title-row"
          justifyContent={{ default: "justifyContentSpaceBetween" }}
          alignItems={{ default: "alignItemsCenter" }}
          direction={{ default: "row", lg: "row" }}
        >
          <FlexItem flex={{ default: "flex_1" }} className="modal-title-container">
            <h2 className="modal-title">
              <span className="modal-action-text">
                {isNew ? "Created file:" : "Modified file:"}
              </span>
              <span className="modal-filename">{fileName}</span>
            </h2>
          </FlexItem>
          
          {/* Close button - Always visible */}
          <FlexItem className="modal-close-container">
            <Button
              variant="plain"
              onClick={onClose}
              icon={<CompressIcon />}
              className="modal-close-button"
              aria-label="Close modal"
            />
          </FlexItem>
        </Flex>

        {/* Action Row - Responsive layout */}
        <Flex 
          className="modal-action-row"
          justifyContent={{ default: "justifyContentSpaceBetween" }}
          alignItems={{ default: "alignItemsCenter" }}
          direction={{ default: "column", md: "row" }}
          gap={{ default: "gapSm", md: "gapMd" }}
        >
          {/* Bulk Selection Controls - Left side on desktop, top on mobile */}
          {!isSingleHunk && actionTaken === null && (
            <FlexItem className="bulk-controls-container">
              <Flex 
                gap={{ default: "gapSm" }} 
                alignItems={{ default: "alignItemsCenter" }}
                direction={{ default: "row" }}
                justifyContent={{ default: "justifyContentFlexStart", md: "justifyContentFlexStart" }}
              >
                <FlexItem>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<PlusCircleIcon />}
                    onClick={onSelectAll}
                    aria-label="Select all hunks"
                    className="bulk-select-button"
                  >
                    Select All
                  </Button>
                </FlexItem>
                <FlexItem>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<MinusCircleIcon />}
                    onClick={onDeselectAll}
                    aria-label="Deselect all hunks"
                    className="bulk-select-button"
                  >
                    Deselect All
                  </Button>
                </FlexItem>
              </Flex>
            </FlexItem>
          )}

          {/* Main Action Buttons - Right side on desktop, bottom on mobile */}
          <FlexItem className="main-actions-container">
            <Flex 
              gap={{ default: "gapSm" }} 
              alignItems={{ default: "alignItemsCenter" }}
              direction={{ default: "row" }}
              justifyContent={{ default: "justifyContentCenter", md: "justifyContentFlexEnd" }}
            >
              {/* Action buttons - shown for both single and multi-hunk when no action taken */}
              {actionTaken === null && (
                <>
                  <FlexItem>
                    <Button
                      variant={selectionState?.type === "none" ? "secondary" : "primary"}
                      size="sm"
                      icon={<CheckIcon />}
                      onClick={onApply}
                      isDisabled={isAcceptDisabled}
                      aria-label={selectionState?.description || "Accept changes"}
                      title={selectionState?.description || "Accept changes"}
                      className="modal-accept-button"
                    >
                      {isSingleHunk ? "Accept" : selectionState?.text || "Accept"}
                    </Button>
                  </FlexItem>
                  <FlexItem>
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<CloseIcon />}
                      onClick={onReject}
                      aria-label="Reject all changes"
                      className="modal-reject-button"
                    >
                      {isSingleHunk ? "Reject" : "Reject All"}
                    </Button>
                  </FlexItem>
                </>
              )}

              {/* Status indicator for completed actions */}
              {actionTaken && (
                <FlexItem>
                  <span className={`action-status ${actionTaken}`}>
                    {actionTaken === "applied" ? "✓ Applied" : "✗ Rejected"}
                  </span>
                </FlexItem>
              )}
            </Flex>
          </FlexItem>
        </Flex>
      </div>
    </div>
  );
};
