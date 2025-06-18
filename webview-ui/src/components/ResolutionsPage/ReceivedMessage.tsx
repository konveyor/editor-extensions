import "./receivedMessage.css";
import React from "react";
import { Message } from "@patternfly/chatbot";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import botAv from "./bot_avatar.svg?inline";

interface QuickResponse {
  id: string;
  content: string;
  messageToken: string;
  onClick?: () => void;
  isDisabled?: boolean;
}

interface ReceivedMessageProps {
  content?: string;
  extraContent?: React.ReactNode;
  isLoading?: boolean;
  timestamp?: string | Date;
  quickResponses?: QuickResponse[];
  isCompact?: boolean;
  isProcessing?: boolean;
}

export const ReceivedMessage: React.FC<ReceivedMessageProps> = ({
  content,
  extraContent,
  isLoading,
  timestamp = new Date(),
  quickResponses,
  isCompact = false,
  isProcessing = false,
}) => {
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
    window.vscode.postMessage({
      type: "QUICK_RESPONSE",
      payload: {
        responseId,
        messageToken,
      },
    });
  };

  return (
    <Message
      timestamp={formatTimestamp(timestamp)}
      name="Konveyor"
      role="bot"
      isLoading={isLoading || isProcessing}
      avatar={botAv}
      content={content}
      quickResponses={quickResponses?.map((response) => ({
        ...response,
        onClick: () => {
          console.log("handleQuickResponse", response.id, response.messageToken);  
          handleQuickResponse(response.id, response.messageToken);
        },
        isDisabled: response.isDisabled || isProcessing,
      }))}
      // isCompact={isCompact}
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
