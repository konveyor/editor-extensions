import { Message } from "@patternfly/chatbot";
import React from "react";
import userAv from "./user_avatar.svg";

interface SentMessageProps {
  content: string;
  extraContent?: React.ReactNode;
  timestamp?: string | Date;
}

export const SentMessage = React.memo<SentMessageProps>(
  ({ content, extraContent, timestamp = new Date() }) => {
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
        name="User"
        role="user"
        avatar={userAv}
        content={content}
        extraContent={
          extraContent
            ? {
                afterMainContent: extraContent,
              }
            : undefined
        }
      />
    );
  },
);

SentMessage.displayName = "SentMessage";
