import React from "react";
import { FlexItem, Label } from "@patternfly/react-core";

interface SentResponseProps {
  children: React.ReactNode;
  className?: string;
}

export const SentResponse: React.FC<SentResponseProps> = ({ children, className = "" }) => {
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
