import React from "react";
import { Button, Label, Spinner } from "@patternfly/react-core";
import { OnIcon } from "@patternfly/react-icons";
import "./styles.css";

interface ServerStatusToggleProps {
  isRunning: boolean;
  isStarting: boolean;
  isInitializing: boolean;
  hasWarning: boolean;
  onToggle: () => void;
}

export function ServerStatusToggle({
  isRunning,
  isStarting,
  isInitializing,
  hasWarning,
  onToggle,
}: ServerStatusToggleProps) {
  return (
    <div className="server-status-container">
      <div className="server-status-wrapper">
        <p className="server-status-label">Server Status</p>
        <Label color={isRunning ? "green" : "red"} isCompact>
          {isRunning ? "Running" : "Stopped"}
        </Label>
        <div className="vertical-divider" />
        <Button
          variant="plain"
          icon={isStarting || isInitializing ? <Spinner size="sm" /> : <OnIcon />}
          onClick={onToggle}
          isDisabled={isStarting || isInitializing || hasWarning}
          className="server-action-button"
        >
          {isStarting || isInitializing ? "" : isRunning ? "Stop" : "Start"}
        </Button>
      </div>
    </div>
  );
}
