import React from "react";
import { FlexItem, Label } from "@patternfly/react-core";

interface SentMessageProps {
  children: React.ReactNode;
  className?: string;
}

export const SentMessage: React.FC<SentMessageProps> = ({ children, className = "" }) => {
  return (
    <FlexItem className={`response-wrapper ${className}`}>
      <Label className="resolutions-show-in-light" color="yellow">
        {children}
      </Label>
      <Label className="resolutions-show-in-dark" variant="outline">
        {children}
      </Label>
    </FlexItem>
  );
};
