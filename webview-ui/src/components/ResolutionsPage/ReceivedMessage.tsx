import React, { useState } from "react";
import { Message } from "@patternfly/chatbot";
import { QuickResponse, DiagnosticSummary } from "@editor-extensions/shared";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import botAv from "./bot_avatar.svg?inline";
import DiagnosticMessage from "./DiagnosticMessage";
import { quickResponse } from "../../hooks/actions";

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
  question?: string; // Optional question to provide context for Yes/No buttons
}

export const ReceivedMessage: React.FC<ReceivedMessageProps> = ({
  content,
  extraContent,
  isLoading,
  timestamp = new Date(),
  quickResponses,
  isProcessing = false,
  diagnosticSummary,
  question,
}) => {
  const [selectedResponse, setSelectedResponse] = useState<string | null>(null);

  // If we have diagnostic summary, use the DiagnosticMessage component
  if (diagnosticSummary) {
    return (
      <DiagnosticMessage
        content={content}
        extraContent={extraContent}
        isLoading={isLoading}
        timestamp={timestamp}
        quickResponses={quickResponses}
        isProcessing={isProcessing}
        diagnosticSummary={diagnosticSummary}
        question={question}
      />
    );
  }

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
      })
    );
  };

  return (
    <Message
      timestamp={formatTimestamp(timestamp)}
      name="Konveyor"
      role="bot"
      avatar={botAv}
      content={content || ""} // Ensure content is never undefined
      quickResponses={
        quickResponses?.map((response) => ({
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
  );
};

export default ReceivedMessage;
