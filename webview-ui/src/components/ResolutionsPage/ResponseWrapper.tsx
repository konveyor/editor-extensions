import React, { FC } from "react";
import { Label, FlexItem } from "@patternfly/react-core";

interface ResponseWrapperProps {
  type: "sent" | "received";
  children: React.ReactNode;
  className?: string;
}

export const ResponseWrapper: FC<ResponseWrapperProps> = ({ type, children, className = "" }) => {
  if (type === "sent") {
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
  }

  return (
    <FlexItem className={`response-wrapper ${className}`}>
      <Label color="blue">{children}</Label>
    </FlexItem>
  );
};
