import "./configButton.css";
import React from "react";
import { Button, Icon, Tooltip } from "@patternfly/react-core";
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
    <Tooltip content={hasWarning ? warningMessage : "Configuration"} position="bottom">
      <Button
        variant="plain"
        onClick={onClick}
        aria-label="Configuration"
        className="config-button"
      >
        <span className="config-button__icon-wrapper">
          <Icon isInline>
            <CogIcon />
          </Icon>
          {hasWarning && <ExclamationTriangleIcon className="config-button__warning-icon" />}
        </span>
      </Button>
    </Tooltip>
  );
}
