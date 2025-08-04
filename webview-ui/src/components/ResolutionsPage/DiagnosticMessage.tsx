import React, { useState } from "react";
import { Message } from "@patternfly/chatbot";
import { QuickResponse, DiagnosticIssue, DiagnosticSummary } from "@editor-extensions/shared";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import botAv from "./bot_avatar.svg?inline";
import DiagnosticIssuesView from "./DiagnosticIssuesView";
import { quickResponse } from "../../hooks/actions";

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

  const handleQuickResponse = (responseId: string, messageToken: string) => {
    // Update state to reflect selected response
    // Note: Consider using React.memo or other optimization techniques if flickering persists
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

  return (
    <>
      <Message
        timestamp={formatTimestamp(timestamp)}
        name="Konveyor"
        role="bot"
        avatar={botAv}
        content={content || ""}
        additionalRehypePlugins={[rehypeRaw, rehypeSanitize]}
      />

      <DiagnosticIssuesView
        diagnosticSummary={diagnosticSummary}
        onIssueSelectionChange={handleIssueSelectionChange}
        isMessageResponded={isMessageResponded}
      />

      {question && quickResponses && quickResponses.length > 0 && (
        <Message
          timestamp={formatTimestamp(timestamp)}
          name="Konveyor"
          role="bot"
          avatar={botAv}
          content={question}
          quickResponses={quickResponses.map((response) => ({
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
          }))}
          additionalRehypePlugins={[rehypeRaw, rehypeSanitize]}
        />
      )}
    </>
  );
};

export default DiagnosticMessage;
