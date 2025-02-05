import React from "react";
import { FlexItem, Label } from "@patternfly/react-core";

interface ReceivedMessageProps {
  children: React.ReactNode;
  className?: string;
}

export const ReceivedMessage: React.FC<ReceivedMessageProps> = ({ children, className = "" }) => {
  return (
    <FlexItem className={`response-wrapper ${className}`}>
      <Label color="blue">{children}</Label>
    </FlexItem>
  );
};
