import React, { useState } from "react";
import { Message } from "@patternfly/chatbot";
import { QuickResponse } from "@editor-extensions/shared";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import botAv from "./bot_avatar.svg?inline";
import DiagnosticIssuesView from "./DiagnosticIssuesView";
import { quickResponse } from "../../hooks/actions";

// Import diagnostic types from the shared types file
interface DiagnosticIssue {
  id: string;
  message: string;
  uri: string;
  filename: string;
  selected?: boolean;
}

interface DiagnosticSummary {
  summary: string;
  issuesByFile: Record<string, DiagnosticIssue[]>;
  totalIssues: number;
}

interface QuickResponseWithToken extends QuickResponse {
  messageToken: string;
}

interface ReceivedMessageProps {
  content?: string;
  extraContent?: React.ReactNode;
  isLoading?: boolean;
  timestamp?: string | Date;
  quickResponses?: QuickResponseWithToken[];
  isProcessing?: boolean;
  diagnosticSummary?: DiagnosticSummary;
}

export const ReceivedMessage: React.FC<ReceivedMessageProps> = ({
  content,
  extraContent,
  isLoading,
  timestamp = new Date(),
  quickResponses,
  isProcessing = false,
  diagnosticSummary,
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
    window.vscode.postMessage(
      quickResponse({
        responseId,
        messageToken,
        selectedIssues: selectedIssues.map(issue => issue.id), // Include selected issues
      })
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
        content={content || ""} // Ensure content is never undefined
        quickResponses={
          diagnosticSummary 
            ? undefined // Don't show quick responses in Message when we have diagnostic summary
            : quickResponses?.map((response) => ({
                ...response,
                onClick: () => {
                  handleQuickResponse(response.id, response.messageToken);
                },
                isDisabled: response.isDisabled || isProcessing || selectedResponse !== null,
                content: response.content,
              }))
        }
        additionalRehypePlugins={[rehypeRaw, rehypeSanitize]}
      />
      
      {diagnosticSummary && (
        <DiagnosticIssuesView
          diagnosticSummary={diagnosticSummary}
          onIssueSelectionChange={handleIssueSelectionChange}
          quickResponses={quickResponses}
          isProcessing={isProcessing}
        />
      )}
    </>
  );
};

export default ReceivedMessage;
