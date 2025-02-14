import { Message } from "@patternfly/chatbot";
import React from "react";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
interface ReceivedMessageProps {
  children?: React.ReactNode;
  className?: string;
  isLoading?: boolean;
  mainContent?: string;
}

export const ReceivedMessage: React.FC<ReceivedMessageProps> = ({
  children,
  mainContent,
  isLoading,
}) => {
  return (
    <Message
      timestamp=""
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
