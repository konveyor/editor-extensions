import React from "react";
import { Button, Flex, FlexItem, Tooltip, Icon } from "@patternfly/react-core";
import {
  CheckCircleIcon,
  TimesCircleIcon,
  EyeIcon,
  CodeIcon,
  InfoCircleIcon,
  ExclamationTriangleIcon,
} from "@patternfly/react-icons";
import { NormalizedFileData } from "./useModifiedFileData";
import "./modifiedFileActions.css";

interface ModifiedFileActionsProps {
  actionTaken: "applied" | "rejected" | null;
  mode: "agent" | "non-agent";
  normalizedData: NormalizedFileData;
  onApply: () => void;
  onReject: () => void;
  onView: (path: string, diff: string) => void;
  onViewWithDecorations?: (path: string, diff: string) => void;
  onQuickResponse: (responseId: string) => void;
  isFileApplied?: boolean;
  onContinue?: () => void;
}

// Status Display Component
const StatusDisplay: React.FC<{ status: "applied" | "rejected" }> = ({ status }) => (
  <Flex className="modified-file-actions">
    <FlexItem>
      <span>
        {status === "applied" ? (
          <>
            <CheckCircleIcon color="green" /> Changes applied
          </>
        ) : (
          <>
            <TimesCircleIcon color="red" /> Changes rejected
          </>
        )}
      </span>
    </FlexItem>
  </Flex>
);

// Status Banner - shown when viewing diff to guide user
const DiffStatusBanner: React.FC<{ onApplyChanges: () => void }> = ({ onApplyChanges }) => (
  <Flex className="modified-file-actions" justifyContent={{ default: "justifyContentCenter" }}>
    <FlexItem>
      <div className="diff-status-banner">
        <Icon status="warning">
          <ExclamationTriangleIcon color="#b98412" />
        </Icon>
        <span>Reviewing changes in editor</span>
        <Tooltip
          content={
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
            </div>
          }
          position="bottom"
        >
          <Icon>
            <InfoCircleIcon color="#4394e5" />
          </Icon>
        </Tooltip>
        <Button variant="link" onClick={onApplyChanges} className="continue-button">
          Continue
        </Button>
      </div>
    </FlexItem>
  </Flex>
);

// Primary Action Buttons Component
const PrimaryActionButtons: React.FC<{
  isNew: boolean;
  mode: "agent" | "non-agent";
  actionTaken: "applied" | "rejected" | null;
  onView: () => void;
  onViewWithDecorations?: () => void;
  onApply: () => void;
  onReject: () => void;
  isViewingDiff?: boolean;
}> = ({
  isNew,
  mode,
  actionTaken,
  onView,
  onViewWithDecorations,
  onApply,
  onReject,
  isViewingDiff,
}) => (
  <Flex
    className="modified-file-actions"
    justifyContent={{ default: "justifyContentSpaceBetween" }}
  >
    <FlexItem>
      <Flex gap={{ default: "gapMd" }}>
        {/* View with Decorations - Primary action for agent mode */}
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

        {/* View in VSCode - Secondary action */}
        {!isNew && mode !== "agent" && (
          <FlexItem>
            <Button
              variant="link"
              icon={<EyeIcon />}
              onClick={onView}
              aria-label="View file in VSCode"
              isDisabled={actionTaken !== null}
              className="secondary-action-button"
            >
              View in VSCode
            </Button>
          </FlexItem>
        )}
      </Flex>
    </FlexItem>

    {/* Accept/Reject buttons - only shown when not viewing diff */}
    {!isViewingDiff && (
      <FlexItem>
        <Flex gap={{ default: "gapMd" }}>
          <FlexItem>
            <Button
              variant="primary"
              icon={<CheckCircleIcon />}
              onClick={onApply}
              aria-label="Accept all changes"
              className="main-accept-button"
              isDisabled={actionTaken !== null}
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
              isDisabled={actionTaken !== null}
            >
              Reject All
            </Button>
          </FlexItem>
        </Flex>
      </FlexItem>
    )}
  </Flex>
);

// Quick Response Buttons Component
const QuickResponseButtons: React.FC<{
  quickResponses: Array<{ id: string; content: string }>;
  isNew: boolean;
  mode: "agent" | "non-agent";
  actionTaken: "applied" | "rejected" | null;
  onView: () => void;
  onQuickResponse: (responseId: string) => void;
  onApply: () => void;
  onReject: () => void;
}> = ({ quickResponses, isNew, mode, actionTaken, onView, onQuickResponse }) => (
  <Flex
    className="modified-file-actions"
    justifyContent={{ default: "justifyContentSpaceBetween" }}
  >
    <FlexItem>
      <Flex gap={{ default: "gapMd" }}>
        {!isNew && mode !== "agent" && (
          <FlexItem>
            <Button
              variant="link"
              icon={<EyeIcon />}
              onClick={onView}
              aria-label="View file in VSCode"
              className="secondary-action-button"
            >
              View
            </Button>
          </FlexItem>
        )}
      </Flex>
    </FlexItem>
    <FlexItem>
      <Flex gap={{ default: "gapMd" }}>
        {/* Quick Response Buttons */}
        {quickResponses.map((response) => (
          <FlexItem key={response.id}>
            <Button
              variant={response.id === "apply" ? "primary" : "danger"}
              icon={response.id === "apply" ? <CheckCircleIcon /> : <TimesCircleIcon />}
              className={response.id === "apply" ? "quick-accept-button" : "quick-reject-button"}
              onClick={() => onQuickResponse(response.id)}
              aria-label={response.id === "apply" ? "Apply changes" : "Reject changes"}
              isDisabled={actionTaken !== null}
            >
              {response.content}
            </Button>
          </FlexItem>
        ))}
      </Flex>
    </FlexItem>
  </Flex>
);

// Main Component
const ModifiedFileActions: React.FC<ModifiedFileActionsProps> = ({
  actionTaken,
  mode,
  normalizedData,
  onApply,
  onReject,
  onView,
  onViewWithDecorations,
  onQuickResponse,
  isFileApplied,
  onContinue,
}) => {
  const { isNew, quickResponses } = normalizedData;

  // If action already taken, show status
  if (actionTaken) {
    return <StatusDisplay status={actionTaken} />;
  }

  // If viewing diff and in agent mode, show status banner
  if (isFileApplied && mode === "agent") {
    return (
      <DiffStatusBanner
        onApplyChanges={() => {
          // Apply changes automatically (like the old Continue logic)
          onContinue?.();
        }}
      />
    );
  }

  // If quick responses available, show quick response buttons
  if (quickResponses && quickResponses.length > 0) {
    return (
      <QuickResponseButtons
        quickResponses={quickResponses}
        isNew={isNew}
        mode={mode}
        actionTaken={actionTaken}
        onView={() => onView(normalizedData.path, normalizedData.diff)}
        onQuickResponse={onQuickResponse}
        onApply={onApply}
        onReject={onReject}
      />
    );
  }

  // Default: show primary action buttons
  return (
    <PrimaryActionButtons
      isNew={isNew}
      mode={mode}
      actionTaken={actionTaken}
      onView={() => onView(normalizedData.path, normalizedData.diff)}
      onViewWithDecorations={
        onViewWithDecorations
          ? () => onViewWithDecorations(normalizedData.path, normalizedData.diff)
          : undefined
      }
      onApply={onApply}
      onReject={onReject}
      isViewingDiff={isFileApplied}
    />
  );
};

export default ModifiedFileActions;
