import React from "react";

interface ToolCallIndicatorProps {
  name: string;
  status: "running" | "succeeded" | "failed" | "pending";
  result?: string;
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  read_file: "Reading file",
  write_file: "Writing file",
  list_directory: "Listing directory",
  search_files: "Searching files",
  shell: "Running command",
  text_editor: "Editing file",
  developer__shell: "Running command",
  developer__text_editor: "Editing file",
  developer__read_file: "Reading file",
  developer__list_directory: "Listing directory",
  run_analysis: "Running analysis",
  get_analysis_results: "Getting analysis results",
  get_incidents_by_file: "Getting incidents",
  apply_file_changes: "Applying changes",
};

function getDisplayName(toolName: string): string {
  if (TOOL_DISPLAY_NAMES[toolName]) {
    return TOOL_DISPLAY_NAMES[toolName];
  }
  return toolName
    .replace(/__/g, " ")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export const ToolCallIndicator: React.FC<ToolCallIndicatorProps> = ({
  name,
  status,
}) => {
  const displayName = getDisplayName(name);
  const isRunning = status === "running" || status === "pending";

  return (
    <div className={`goose-tool-call goose-tool-call--${status}`}>
      <span className="goose-tool-call__icon">
        {isRunning ? "⚙️" : status === "succeeded" ? "✓" : "✗"}
      </span>
      <span className="goose-tool-call__name">{displayName}</span>
      {isRunning && <span className="goose-tool-call__spinner" />}
    </div>
  );
};
