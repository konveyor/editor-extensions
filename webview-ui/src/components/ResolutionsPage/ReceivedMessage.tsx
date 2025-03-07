import "./receivedMessage.css";
import React from "react";
import { Message } from "@patternfly/chatbot";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import botAv from "./bot_avatar.svg?inline";

interface ReceivedMessageProps {
  content?: string;
  extraContent?: React.ReactNode;
  isLoading?: boolean;
  timestamp?: string | Date;
}

export const ReceivedMessage: React.FC<ReceivedMessageProps> = ({
  content,
  extraContent,
  isLoading,
  timestamp = new Date(),
}) => {
  const formatTimestamp = (time: string | Date): string => {
    const date = typeof time === "string" ? new Date(time) : time;
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <Message
      timestamp={formatTimestamp(timestamp)}
      name="Konveyor"
      role="bot"
      isLoading={isLoading}
      avatar={botAv}
      content={content}
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
