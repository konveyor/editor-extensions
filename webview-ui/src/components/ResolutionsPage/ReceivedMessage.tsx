import "./receivedMessage.css";
import React, { useState, useEffect } from "react";
import { Message } from "@patternfly/chatbot";
import { QuickResponse, DiagnosticSummary } from "@editor-extensions/shared";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import avatar from "../../../public/avatarIcons/avatar.svg?inline";
import DiagnosticMessage from "./DiagnosticMessage";
import { quickResponse } from "../../hooks/actions";
import { getBrandName } from "../../utils/branding";

interface QuickResponseWithState extends QuickResponse {
  messageToken: string;
  isSelected?: boolean;
}

interface ReceivedMessageProps {
  content?: string;
  extraContent?: React.ReactNode;
  isLoading?: boolean;
  timestamp?: string | Date;
  quickResponses?: QuickResponseWithState[];
  isProcessing?: boolean;
  isMessageResponded?: boolean;
  diagnosticSummary?: DiagnosticSummary;
  question?: string; // Optional question to provide context for Yes/No buttons
  onQuickResponse?: () => void; // Callback when a quick response is selected
}

export const ReceivedMessage: React.FC<ReceivedMessageProps> = ({
  content,
  extraContent,
  isLoading,
  timestamp = new Date(),
  quickResponses,
  isProcessing,
  isMessageResponded = false,
  diagnosticSummary,
  question,
  onQuickResponse,
}) => {
  // Check if there's already a selectedResponse from the message data (restored from persistence)
  const initialSelectedResponse =
    quickResponses?.find((response) => response.isSelected === true)?.id || null;

  const [selectedResponse, setSelectedResponse] = useState<string | null>(initialSelectedResponse);

  // Update selectedResponse if initialSelectedResponse changes (e.g., when persistence data loads)
  useEffect(() => {
    if (initialSelectedResponse && selectedResponse !== initialSelectedResponse) {
      setSelectedResponse(initialSelectedResponse);
    }
  }, [initialSelectedResponse]);

  // If we have diagnostic summary, use the DiagnosticMessage component
  if (diagnosticSummary) {
    return (
      <DiagnosticMessage
        content={content}
        extraContent={extraContent}
        isLoading={isLoading}
        timestamp={timestamp}
        quickResponses={quickResponses}
        isMessageResponded={isMessageResponded}
        diagnosticSummary={diagnosticSummary}
        question={question}
        onQuickResponse={onQuickResponse}
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

    // Notify parent that a quick response was selected
    if (onQuickResponse) {
      onQuickResponse();
    }

    window.vscode.postMessage(
      quickResponse({
        responseId,
        messageToken,
      }),
    );
  };

  return (
    <Message
      timestamp={formatTimestamp(timestamp)}
      name={getBrandName()}
      role="bot"
      avatar={avatar}
      content={content || ""} // Ensure content is never undefined
      quickResponses={quickResponses?.map((response) => ({
        ...response,
        onClick: () => {
          handleQuickResponse(response.id, response.messageToken);
        },
        isDisabled: response.isDisabled || isProcessing || isMessageResponded || selectedResponse !== null,
        content: response.content,
      }))}
      extraContent={
        extraContent
          ? {
              afterMainContent: extraContent,
            }
          : undefined
      }
      additionalRehypePlugins={[rehypeRaw, rehypeSanitize]}
    />
  );
};

export default ReceivedMessage;
