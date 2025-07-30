import React from "react";
import { Button, Label, Spinner, Tooltip } from "@patternfly/react-core";
import { OnIcon, OffIcon } from "@patternfly/react-icons";
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
  const getButtonContent = () => {
    if (isStarting || isInitializing) {
      return (
        <>
          <Spinner size="sm" aria-label="Loading spinner" className="header-spinner" />
          <span className="button-text">
            {isStarting ? "Starting..." : "Initializing..."}
          </span>
        </>
      );
    }
    
    return (
      <>
        {isRunning ? <OnIcon className="button-icon" /> : <OffIcon className="button-icon" />}
        <span className="button-text">
          {isRunning ? "Stop Server" : "Start Server"}
        </span>
        <span className="button-text-short">
          {isRunning ? "Stop" : "Start"}
        </span>
      </>
    );
  };

  const getTooltipContent = () => {
    if (hasWarning) {
      return "Cannot start server: Check your configuration";
    }
    if (isStarting) {
      return "Server is starting...";
    }
    if (isInitializing) {
      return "Server is initializing...";
    }
    return isRunning ? "Click to stop the analyzer server" : "Click to start the analyzer server";
  };

  return (
    <div className="server-status-header-wrapper">
      <Tooltip content={getTooltipContent()}>
        <Button
          variant={isRunning ? "secondary" : "primary"}
          size="sm"
          onClick={onToggle}
          isDisabled={isStarting || isInitializing || hasWarning}
          className={`header-server-button ${isRunning ? 'server-running' : 'server-stopped'}`}
        >
          {getButtonContent()}
        </Button>
      </Tooltip>
      
      <Label 
        color={isRunning ? "green" : hasWarning ? "orange" : "red"} 
        isCompact 
        className="server-status-label"
      >
        <span className="status-text-full">
          {isRunning ? "Running" : hasWarning ? "Config Error" : "Stopped"}
        </span>
        <span className="status-text-short">
          {isRunning ? "On" : hasWarning ? "Err" : "Off"}
        </span>
      </Label>
    </div>
  );
}
