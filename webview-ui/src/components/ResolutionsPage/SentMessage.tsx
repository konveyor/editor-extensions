import { Message } from "@patternfly/chatbot";
import React from "react";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

interface SentMessageProps {
  children?: React.ReactNode;
  mainContent: string;
  timestamp?: string | Date;
}

export const SentMessage: React.FC<SentMessageProps> = ({
  children,
  mainContent,
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
      name="User"
      role="user"
      content={mainContent}
      extraContent={{ afterMainContent: children }}
      avatar="https://raw.githubusercontent.com/patternfly/patternfly-react/main/packages/react-core/src/components/assets/avatarImg.svg"
      additionalRehypePlugins={[rehypeRaw, rehypeSanitize]}
    />
  );
};
