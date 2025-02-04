import React from "react";
import { FlexItem, Label } from "@patternfly/react-core";

interface ReceivedResponseProps {
  children: React.ReactNode;
  className?: string;
}

export const ReceivedResponse: React.FC<ReceivedResponseProps> = ({ children, className = "" }) => {
  return (
    <FlexItem className={`response-wrapper ${className}`}>
      <Label color="blue">{children}</Label>
    </FlexItem>
  );
};
