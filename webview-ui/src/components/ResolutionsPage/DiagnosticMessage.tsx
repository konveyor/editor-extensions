import React, { useState } from "react";
import { Message } from "@patternfly/chatbot";
import { QuickResponse, DiagnosticIssue, DiagnosticSummary } from "@editor-extensions/shared";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import avatar from "../../../public/avatarIcons/avatar.svg?inline";
import DiagnosticIssuesView from "./DiagnosticIssuesView";
import { quickResponse } from "../../hooks/actions";
import "./diagnosticIssuesView.css";

interface QuickResponseWithToken extends QuickResponse {
  messageToken: string;
}

interface DiagnosticMessageProps {
  content?: string;
  extraContent?: React.ReactNode;
  isLoading?: boolean;
  timestamp?: string | Date;
  quickResponses?: QuickResponseWithToken[];
  isMessageResponded?: boolean;
  diagnosticSummary: DiagnosticSummary;
  question?: string; // Optional question to provide context for Yes/No buttons
  onQuickResponse?: () => void; // Callback when a quick response is selected
}

export const DiagnosticMessage: React.FC<DiagnosticMessageProps> = ({
  content,
  extraContent,
  isLoading,
  timestamp = new Date(),
  quickResponses,
  isMessageResponded = false,
  diagnosticSummary,
  question,
  onQuickResponse,
}) => {
  const [selectedResponse, setSelectedResponse] = useState<string | null>(null);
  const [selectedIssues, setSelectedIssues] = useState<DiagnosticIssue[]>([]);

  // Don't render anything if there's no content and no extra content
  // This prevents "phantom" blank messages from appearing
  if (!content && !extraContent && !quickResponses?.length) {
    return null;
  }

  const formatTimestamp = (time: string | Date): string => {
    const date = typeof time === "string" ? new Date(time) : time;
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const handleQuickResponse = (responseId: string, messageToken: string, autoSelectAll = false) => {
    // For "Fix All", select all issues first
    if (autoSelectAll) {
      const allIssues = Object.values(diagnosticSummary.issuesByFile).flat();
      setSelectedIssues(allIssues);

      // Update state to reflect that we selected "yes" (since Fix All is essentially yes with all selected)
      setSelectedResponse("yes");

      // Notify parent that a quick response was selected
      if (onQuickResponse) {
        onQuickResponse();
      }

      // Send message with all issues selected
      window.vscode.postMessage(
        quickResponse({
          responseId: "yes", // Fix All is essentially "yes" with all issues selected
          messageToken,
          selectedIssues: allIssues.map((issue) => issue.id),
        }),
      );
      return;
    }

    // Normal quick response handling
    setSelectedResponse(responseId);

    // Notify parent that a quick response was selected
    if (onQuickResponse) {
      onQuickResponse();
    }

    window.vscode.postMessage(
      quickResponse({
        responseId,
        messageToken,
        selectedIssues: selectedIssues.map((issue) => issue.id), // Include selected issues
      }),
    );
  };

  const handleIssueSelectionChange = (issues: DiagnosticIssue[]) => {
    setSelectedIssues(issues);
  };

  // If we have a question and quick responses, show everything in one message
  if (question && quickResponses && quickResponses.length > 0) {
    return (
      <Message
        timestamp={formatTimestamp(timestamp)}
        name="Konveyor"
        role="bot"
        avatar={avatar}
        content={content || ""}
        extraContent={{
          afterMainContent: (
            <div className="diagnostic-message-combined">
              <DiagnosticIssuesView
                diagnosticSummary={diagnosticSummary}
                onIssueSelectionChange={handleIssueSelectionChange}
                isMessageResponded={isMessageResponded}
              />
              <div className="diagnostic-question-section">
                <div className="diagnostic-question">
                  {selectedIssues.length > 0
                    ? `Based on the ${selectedIssues.length} issue${selectedIssues.length !== 1 ? "s" : ""} selected above, would you like me to fix them?`
                    : "Would you like me to fix the selected issues? You can also use 'Fix All' to automatically fix all issues."}
                </div>
              </div>
            </div>
          ),
        }}
        quickResponses={[
          ...quickResponses.map((response) => ({
            ...response,
            onClick: () => {
              handleQuickResponse(response.id, response.messageToken);
            },
            isDisabled:
              response.isDisabled ||
              isMessageResponded ||
              selectedResponse !== null ||
              (response.id === "yes" && selectedIssues.length === 0),
            content: response.content,
          })),
          // Add "Fix All" button
          {
            id: "fix-all",
            content: `Fix All (${diagnosticSummary.totalIssues} issues)`,
            onClick: () => {
              handleQuickResponse("fix-all", quickResponses[0]?.messageToken || "", true);
            },
            isDisabled:
              isMessageResponded ||
              selectedResponse !== null ||
              diagnosticSummary.totalIssues === 0,
          },
        ]}
        additionalRehypePlugins={[rehypeRaw, rehypeSanitize]}
      />
    );
  }

  // Otherwise, render just the diagnostic view without quick responses
  return (
    <Message
      timestamp={formatTimestamp(timestamp)}
      name="Konveyor"
      role="bot"
      avatar={avatar}
      content={content || ""}
      extraContent={{
        afterMainContent: (
          <div className="diagnostic-content-wrapper">
            <DiagnosticIssuesView
              diagnosticSummary={diagnosticSummary}
              onIssueSelectionChange={handleIssueSelectionChange}
              isMessageResponded={isMessageResponded}
            />
          </div>
        ),
      }}
      additionalRehypePlugins={[rehypeRaw, rehypeSanitize]}
    />
  );
};

export default DiagnosticMessage;
