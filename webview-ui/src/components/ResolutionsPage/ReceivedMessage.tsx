import "./receivedMessage.css";
import React from "react";
import { Message } from "@patternfly/chatbot";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import botAv from "./bot_avatar.svg?inline";

interface QuickResponse {
  id: string;
  content: string;
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
  const formatTimestamp = (time: string | Date): string => {
    const date = typeof time === "string" ? new Date(time) : time;
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const handleQuickResponse = (responseId: string) => {
    // Implementation of handleQuickResponse function
    console.log("handleQuickResponse", responseId);
  };

  return (
    <Message
      timestamp={formatTimestamp(timestamp)}
      name="Konveyor"
      role="bot"
      isLoading={isLoading}
      avatar={botAv}
      content={content}
      quickResponses={quickResponses?.map(response => ({
        ...response,
        onClick: () => handleQuickResponse(response.id),
        isDisabled: isProcessing
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
