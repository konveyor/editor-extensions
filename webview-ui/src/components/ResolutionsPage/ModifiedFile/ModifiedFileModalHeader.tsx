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
      return { type: "none", text: "Accept No Changes", description: "Reject all changes" };
    } else if (selectedCount === totalHunks) {
      return {
        type: "all",
        text: "Accept All Changes",
        description: `Apply all ${totalHunks} changes`,
      };
    } else {
      return {
        type: "partial",
        text: `Accept ${selectedCount} Changes`,
        description: `Apply ${selectedCount} of ${totalHunks} changes`,
      };
    }
  };

  const selectionState = getHunkSelectionState();

  return (
    <div className="modal-custom-header sticky-header">
      <Flex
        justifyContent={{ default: "justifyContentSpaceBetween" }}
        alignItems={{ default: "alignItemsCenter" }}
      >
        <FlexItem>
          <div className="modal-title-section">
            <h2 className="modal-title">
              {isNew ? "Created file: " : "Modified file: "}
              <span className="modal-filename">{fileName}</span>
            </h2>
          </div>
        </FlexItem>

        <FlexItem>
          <Flex gap={{ default: "gapMd" }} alignItems={{ default: "alignItemsCenter" }}>
            {/* Multi-hunk selection controls */}
            {!isSingleHunk && actionTaken === null && (
              <>
                <FlexItem>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<PlusCircleIcon />}
                    onClick={onSelectAll}
                    aria-label="Select all hunks"
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
                  >
                    Deselect All
                  </Button>
                </FlexItem>
              </>
            )}

            {/* Action buttons - shown for both single and multi-hunk when no action taken */}
            {actionTaken === null && (
              <>
                <FlexItem>
                  <Button
                    variant={selectionState?.type === "none" ? "secondary" : "primary"}
                    size="sm"
                    icon={<CheckIcon />}
                    onClick={onApply}
                    aria-label={selectionState?.description || "Accept changes"}
                    title={selectionState?.description || "Accept changes"}
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

            {/* Close button */}
            <FlexItem>
              <Button
                variant="plain"
                onClick={onClose}
                icon={<CompressIcon />}
                className="modal-close-button"
                aria-label="Close modal"
              />
            </FlexItem>
          </Flex>
        </FlexItem>
      </Flex>
    </div>
  );
};
