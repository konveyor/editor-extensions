import "./configButton.css";
import React from "react";
import { Button, Tooltip } from "@patternfly/react-core";
import { CogIcon, ExclamationTriangleIcon } from "@patternfly/react-icons";

interface ConfigButtonProps {
  onClick: () => void;
  hasWarning?: boolean;
  warningMessage?: string;
}

export function ConfigButton({
  onClick,
  hasWarning = false,
  warningMessage = "Configuration needs attention",
}: ConfigButtonProps) {
  return (
    <Tooltip content={hasWarning ? warningMessage : "Configuration"} position="bottom">
      <Button
        variant="plain"
        onClick={onClick}
        aria-label="Configuration"
        className="config-button"
      >
        <span className="config-button__icon-wrapper">
          <CogIcon />
          {hasWarning && <ExclamationTriangleIcon className="config-button__warning-icon" />}
        </span>
      </Button>
    </Tooltip>
  );
}
