import "./configButton.css";
import React from "react";
import { Button, Icon } from "@patternfly/react-core";
import CogIcon from "@patternfly/react-icons/dist/esm/icons/cog-icon";
import ExclamationTriangleIcon from "@patternfly/react-icons/dist/esm/icons/exclamation-triangle-icon";

interface ConfigButtonProps {
  onClick: () => void;
  hasWarning?: boolean;
  warningMessage?: string | null;
}

export function ConfigButton({
  onClick,
  hasWarning = false,
  warningMessage = "Configuration needs attention",
}: ConfigButtonProps) {
  return (
    <Button
      variant="plain"
      onClick={onClick}
      aria-label={
        hasWarning ? (warningMessage ?? "Configuration needs attention") : "Configuration"
      }
      className="config-button"
    >
      <span className="config-button__icon-wrapper">
        <Icon isInline>
          <CogIcon />
        </Icon>
        {hasWarning && <ExclamationTriangleIcon className="config-button__warning-icon" />}
      </span>
    </Button>
  );
}
