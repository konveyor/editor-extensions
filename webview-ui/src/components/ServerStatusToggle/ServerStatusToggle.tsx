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
    <div>
      <div className="server-status-wrapper">
        {isStarting ? (
          <Spinner size="sm" aria-label="Loading spinner" className="server-status-spinner" />
        ) : isInitializing ? (
          <Spinner size="sm" aria-label="Loading spinner" className="server-status-spinner" />
        ) : (
          <Button
            variant="control"
            size="sm"
            icon={<OnIcon />}
            onClick={onToggle}
            isDisabled={isStarting || isInitializing || hasWarning}
            className="server-action-button"
          >
            {isStarting || isInitializing ? "" : isRunning ? "Stop" : "Start"}
          </Button>
        )}
        <p>Server Status</p>
        <Label color={isRunning ? "green" : "red"} isCompact>
          {isRunning ? "Running" : "Stopped"}
        </Label>
      </div>
    </div>
  );
}
