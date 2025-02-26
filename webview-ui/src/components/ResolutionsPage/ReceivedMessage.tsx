import React from "react";
import { Message } from "@patternfly/chatbot";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

interface ReceivedMessageProps {
  children?: React.ReactNode;
  className?: string;
  isLoading?: boolean;
  mainContent?: string;
  timestamp?: string | Date;
}

export const ReceivedMessage: React.FC<ReceivedMessageProps> = ({
  children,
  mainContent,
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
      isLoading={isLoading}
      name="Konveyor"
      role="bot"
      content={mainContent}
      extraContent={{
        afterMainContent: children,
      }}
      avatar="https://www.konveyor.io/icons/icon-144x144.png?v=cf571f0074bfb1bc97f12bbac657f89"
      additionalRehypePlugins={[rehypeRaw, rehypeSanitize]}
    />
  );
};

export default ReceivedMessage;
