import React from "react";
import { Button, Flex, FlexItem, Tooltip, Icon, Spinner } from "@patternfly/react-core";
import {
  CheckCircleIcon,
  TimesCircleIcon,
  CodeIcon,
  InfoCircleIcon,
  ExclamationTriangleIcon,
} from "@patternfly/react-icons";
import { NormalizedFileData } from "./useModifiedFileData";
import "./modifiedFileActions.css";

interface ModifiedFileActionsProps {
  actionTaken: "applied" | "rejected" | "processing" | null;
  normalizedData: NormalizedFileData;
  onApply: () => void;
  onReject: () => void;
  onViewWithDecorations?: (path: string, diff: string) => void;
  isViewingDiff?: boolean;
  onContinue?: () => void;
  onSetActionTaken?: (action: "applied" | "rejected" | "processing" | null) => void;
  hasActiveDecorators?: boolean;
}

// Status Display Component
const StatusDisplay: React.FC<{ status: "applied" | "rejected" | "processing" }> = ({ status }) => (
  <Flex className="modified-file-actions">
    <FlexItem>
      <span>
        {status === "applied" ? (
          <>
            <CheckCircleIcon color="green" /> Changes applied
          </>
        ) : status === "rejected" ? (
          <>
            <TimesCircleIcon color="red" /> Changes rejected
          </>
        ) : (
          <>
            <Spinner size="sm" /> Processing...
          </>
        )}
      </span>
    </FlexItem>
  </Flex>
);

// Status Banner - shown when viewing diff to guide user
const DiffStatusBanner: React.FC<{
  onApplyChanges: () => void;
  hasActiveDecorators?: boolean;
  onSetActionTaken?: (action: "applied" | "rejected" | "processing" | null) => void;
}> = ({ onApplyChanges, hasActiveDecorators, onSetActionTaken }) => {
  const showReviewingState = hasActiveDecorators === true || hasActiveDecorators === undefined;

  return (
    <Flex className="modified-file-actions" justifyContent={{ default: "justifyContentCenter" }}>
      <FlexItem>
        <div className="diff-status-banner">
          <Icon status={showReviewingState ? "warning" : "success"}>
            {showReviewingState ? (
              <ExclamationTriangleIcon color="#b98412" />
            ) : (
              <CheckCircleIcon color="green" />
            )}
          </Icon>
          <span>
            {showReviewingState
              ? "Reviewing changes in editor."
              : "All changes have been resolved. Press continue to resume."}
          </span>
          <Tooltip
            content={
              showReviewingState ? (
                <div>
                  The file has opened in the editor to the right of this panel with inline diff
                  decorations.
                  <br />
                  <br />
                  <strong>To accept or reject changes:</strong>
                  <ul style={{ marginLeft: "20px", marginTop: "8px" }}>
                    <li>Use the CodeLens buttons at the top of the file to Accept/Reject All</li>
                    <li>Or use individual block buttons to accept/reject specific changes</li>
                    <li>Changes are auto-accepted when you save the file (Ctrl/Cmd+S)</li>
                  </ul>
                  <br />
                  <strong>Important:</strong> Save your changes (Ctrl/Cmd+S) before clicking
                  Continue to preserve any edits you&apos;ve made.
                </div>
              ) : (
                <div>
                  <strong>All changes have been resolved!</strong>
                  <br />
                  <br />
                  Click <strong>Continue</strong> to resume.
                  <br />
                  <br />
                </div>
              )
            }
            position="bottom"
          >
            <Icon>
              <InfoCircleIcon color="#4394e5" />
            </Icon>
          </Tooltip>
          <Button
            variant="link"
            onClick={() => {
              onSetActionTaken?.("processing");
              onApplyChanges();
            }}
            className="continue-button"
            isDisabled={showReviewingState}
          >
            Continue
          </Button>
        </div>
      </FlexItem>
    </Flex>
  );
};

// Primary Action Buttons Component
const PrimaryActionButtons: React.FC<{
  isNew: boolean;
  actionTaken: "applied" | "rejected" | "processing" | null;
  onViewWithDecorations?: () => void;
  onApply: () => void;
  onReject: () => void;
  isViewingDiff?: boolean;
}> = ({ isNew, actionTaken, onViewWithDecorations, onApply, onReject, isViewingDiff }) => (
  <Flex
    className="modified-file-actions"
    justifyContent={{ default: "justifyContentSpaceBetween" }}
  >
    <FlexItem>
      <Flex gap={{ default: "gapMd" }}>
        {!isNew && onViewWithDecorations && (
          <FlexItem>
            <Button
              variant="primary"
              icon={<CodeIcon />}
              onClick={onViewWithDecorations}
              aria-label="Review file changes with inline diff decorations"
              isDisabled={isViewingDiff || actionTaken !== null}
              className="view-with-decorations-button"
            >
              {isViewingDiff ? "Viewing Diff..." : "Review Changes"}
            </Button>
          </FlexItem>
        )}
      </Flex>
    </FlexItem>

    {/* Accept/Reject buttons - only shown when not viewing diff and no action taken */}
    {!isViewingDiff && actionTaken === null && (
      <FlexItem>
        <Flex gap={{ default: "gapMd" }}>
          <FlexItem>
            <Button
              variant="primary"
              icon={<CheckCircleIcon />}
              onClick={onApply}
              aria-label="Accept all changes"
              className="main-accept-button"
            >
              Accept All
            </Button>
          </FlexItem>
          <FlexItem>
            <Button
              variant="danger"
              icon={<TimesCircleIcon />}
              onClick={onReject}
              aria-label="Reject all changes"
              className="main-reject-button"
            >
              Reject All
            </Button>
          </FlexItem>
        </Flex>
      </FlexItem>
    )}
  </Flex>
);

// Main Component
const ModifiedFileActions: React.FC<ModifiedFileActionsProps> = ({
  actionTaken,
  normalizedData,
  onApply,
  onReject,
  onViewWithDecorations,
  isViewingDiff,
  onContinue,
  onSetActionTaken,
  hasActiveDecorators,
}) => {
  const { isNew } = normalizedData;

  // If action already taken or processing, show status
  if (actionTaken) {
    return <StatusDisplay status={actionTaken} />;
  }

  if (isViewingDiff && actionTaken === null) {
    return (
      <DiffStatusBanner
        onApplyChanges={() => {
          // Apply changes automatically (like the old Continue logic)
          onContinue?.();
        }}
        hasActiveDecorators={hasActiveDecorators}
        onSetActionTaken={onSetActionTaken}
      />
    );
  }

  // Default: show primary action buttons
  return (
    <PrimaryActionButtons
      isNew={isNew}
      actionTaken={actionTaken}
      onViewWithDecorations={
        onViewWithDecorations
          ? () => onViewWithDecorations(normalizedData.path, normalizedData.diff)
          : undefined
      }
      onApply={onApply}
      onReject={onReject}
      isViewingDiff={isViewingDiff}
    />
  );
};

export default ModifiedFileActions;
