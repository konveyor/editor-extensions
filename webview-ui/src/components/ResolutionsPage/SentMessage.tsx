import { Message } from "@patternfly/chatbot";
import React from "react";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

interface SentMessageProps {
  children?: React.ReactNode;
  mainContent: string;
}

export const SentMessage: React.FC<SentMessageProps> = ({ children, mainContent }) => {
  return (
    <Message
      name="User"
      role="user"
      content={mainContent}
      extraContent={{ afterMainContent: children }}
      avatar="https://raw.githubusercontent.com/patternfly/patternfly-react/main/packages/react-core/src/components/assets/avatarImg.svg"
      additionalRehypePlugins={[rehypeRaw, rehypeSanitize]}
    />
  );
};
