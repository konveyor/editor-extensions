import React from "react";
import { Button, Flex, FlexItem } from "@patternfly/react-core";
import { CheckCircleIcon, TimesCircleIcon, EyeIcon, ExpandIcon, CodeIcon, ArrowRightIcon } from "@patternfly/react-icons";
import { NormalizedFileData } from "./useModifiedFileData";

interface ModifiedFileActionsProps {
  actionTaken: "applied" | "rejected" | null;
  mode: "agent" | "non-agent";
  normalizedData: NormalizedFileData;
  onApply: () => void;
  onReject: () => void;
  onView: (path: string, diff: string) => void;
  onViewWithDecorations?: (path: string, diff: string) => void;
  onExpandToggle: () => void;
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

// Decorator Flow Actions - shown when file is applied via decorator but needs Continue
const DecoratorFlowActions: React.FC<{
  onContinue: () => void;
}> = ({ onContinue }) => (
  <Flex className="modified-file-actions" justifyContent={{ default: "justifyContentCenter" }}>
    <FlexItem>
      <Button
        variant="primary"
        icon={<ArrowRightIcon />}
        onClick={onContinue}
        aria-label="Continue to next step"
      >
        Continue
      </Button>
    </FlexItem>
  </Flex>
);

// Action Buttons Component
const ActionButtons: React.FC<{
  isNew: boolean;
  mode: "agent" | "non-agent";
  actionTaken: "applied" | "rejected" | null;
  onView: () => void;
  onViewWithDecorations?: () => void;
  onExpandToggle: () => void;
  onApply: () => void;
  onReject: () => void;
  isFileApplied?: boolean;
}> = ({ isNew, mode, actionTaken, onView, onViewWithDecorations, onExpandToggle, onApply, onReject, isFileApplied }) => (
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
            >
              View
            </Button>
          </FlexItem>
        )}
        {!isNew && onViewWithDecorations && (
          <FlexItem>
            <Button
              variant="link"
              icon={<CodeIcon />}
              onClick={onViewWithDecorations}
              aria-label="Apply file with decorations in VSCode"
              isDisabled={isFileApplied || actionTaken !== null}
            >
              {isFileApplied ? "Applied" : "Apply File"}
            </Button>
          </FlexItem>
        )}
        <FlexItem>
          <Button
            variant="link"
            icon={<ExpandIcon />}
            onClick={onExpandToggle}
            aria-label="Review changes in detail"
            isDisabled={actionTaken !== null || isFileApplied}
          >
            Review Changes
          </Button>
        </FlexItem>
      </Flex>
    </FlexItem>
    {!isFileApplied && (
      <FlexItem>
        <Flex gap={{ default: "gapMd" }}>
          <FlexItem>
            <Button
              variant="link"
              icon={<CheckCircleIcon />}
              onClick={onApply}
              aria-label="Accept all changes"
              className="main-accept-button"
              isDisabled={actionTaken !== null}
            >
              Accept All Changes
            </Button>
          </FlexItem>
          <FlexItem>
            <Button
              variant="link"
              icon={<TimesCircleIcon />}
              onClick={onReject}
              aria-label="Reject all changes"
              className="main-reject-button"
              isDisabled={actionTaken !== null}
            >
              Reject All Changes
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
  onExpandToggle: () => void;
  onQuickResponse: (responseId: string) => void;
  onApply: () => void;
  onReject: () => void;
}> = ({ quickResponses, isNew, mode, actionTaken, onView, onExpandToggle, onQuickResponse, onApply, onReject }) => (
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
            >
              View
            </Button>
          </FlexItem>
        )}
        <FlexItem>
          <Button
            variant="link"
            icon={<ExpandIcon />}
            onClick={onExpandToggle}
            aria-label="Review changes in detail"
            isDisabled={actionTaken !== null}
          >
            Review Changes
          </Button>
        </FlexItem>
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
        {/* Main Accept/Reject Buttons */}
        <FlexItem>
          <Button
            variant="link"
            icon={<CheckCircleIcon />}
            onClick={onApply}
            aria-label="Accept all changes"
            className="main-accept-button"
            isDisabled={actionTaken !== null}
          >
            Accept All Changes
          </Button>
        </FlexItem>
        <FlexItem>
          <Button
            variant="link"
            icon={<TimesCircleIcon />}
            onClick={onReject}
            aria-label="Reject all changes"
            className="main-reject-button"
            isDisabled={actionTaken !== null}
          >
            Reject All Changes
          </Button>
        </FlexItem>
      </Flex>
    </FlexItem>
  </Flex>
);

// Main Actions Component
export const ModifiedFileActions: React.FC<ModifiedFileActionsProps> = ({
  actionTaken,
  mode,
  normalizedData,
  onApply,
  onReject,
  onView,
  onViewWithDecorations,
  onExpandToggle,
  onQuickResponse,
  isFileApplied,
  onContinue,
}) => {
  const { status, quickResponses, messageToken, isNew, path, diff } = normalizedData;

  // Show status if action has been taken
  if (actionTaken || status) {
    return <StatusDisplay status={(actionTaken || status)!} />;
  }

  // Show decorator flow actions if file is applied via decorator but conversation needs to continue
  if (isFileApplied && onContinue) {
    return <DecoratorFlowActions onContinue={onContinue} />;
  }

  // Show quick response buttons if they exist and have content
  if (quickResponses && Array.isArray(quickResponses) && quickResponses.length > 0 && messageToken) {
    return (
      <QuickResponseButtons
        quickResponses={quickResponses}
        isNew={isNew}
        mode={mode}
        actionTaken={actionTaken}
        onView={() => onView(path, diff)}
        onExpandToggle={onExpandToggle}
        onQuickResponse={onQuickResponse}
        onApply={onApply}
        onReject={onReject}
      />
    );
  }

  // Show default action buttons
  return (
    <ActionButtons
      isNew={isNew}
      mode={mode}
      actionTaken={actionTaken}
      onView={() => onView(path, diff)}
      onViewWithDecorations={onViewWithDecorations ? () => onViewWithDecorations(path, diff) : undefined}
      onExpandToggle={onExpandToggle}
      onApply={onApply}
      onReject={onReject}
      isFileApplied={isFileApplied}
    />
  );
};

export default ModifiedFileActions;
