import React, { useState } from "react";
import "./toolMessage.css";
import {
  CheckCircleIcon,
  TimesCircleIcon,
  SyncAltIcon,
  AngleRightIcon,
} from "@patternfly/react-icons";
import type { ChatMessage, ToolMessageValue } from "@editor-extensions/shared";

interface ToolMessageProps {
  toolName: string;
  status: "succeeded" | "failed" | "running";
  detail?: string;
  timestamp?: string | Date;
  errorDetails?: string;
}

export const getHumanReadableToolName = (toolName: string): string => {
  const toolNameMap: Record<string, string> = {
    writeFile: "Editing file",
    readFile: "Read file",
    searchFiles: "Searched files",
    listFiles: "Listed files",
    deleteFile: "Deleted file",
    createFile: "Created file",
    analyzeCode: "Analyzed code",
    searchCode: "Searched code",
    refactorCode: "Refactored code",
    formatCode: "Formatted code",
    gitCommit: "Committed changes",
    gitPush: "Pushed changes",
    gitPull: "Pulled changes",
    gitStatus: "Checked git status",
    buildProject: "Built project",
    runTests: "Ran tests",
    lintCode: "Linted code",
    installDependencies: "Installed dependencies",
    updateDependencies: "Updated dependencies",
    checkDependencies: "Checked dependencies",
    searchFqdn: "Searched dependencies",
    queryDatabase: "Queried database",
    migrateDatabase: "Migrated database",
    text_editor: "Edited file",
    read_file: "Read file",
    write_file: "Wrote file",
    list_directory: "Listed directory",
    search_replace: "Search & replace",
    bash: "Ran command",
    shell: "Ran command",
  };

  return toolNameMap[toolName] || toolName;
};

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  if (status === "succeeded") {
    return <CheckCircleIcon className="tool-status-icon tool-status-icon--success" />;
  }
  if (status === "failed") {
    return <TimesCircleIcon className="tool-status-icon tool-status-icon--error" />;
  }
  return <SyncAltIcon className="tool-status-icon tool-status-icon--running" />;
};

export const ToolMessage: React.FC<ToolMessageProps> = ({ toolName, status, detail }) => {
  const label = getHumanReadableToolName(toolName);

  return (
    <div className={`tool-indicator tool-indicator--${status}`}>
      <StatusIcon status={status} />
      <span className="tool-indicator__label">{label}</span>
      {detail && <span className="tool-indicator__detail">{detail}</span>}
    </div>
  );
};

const MAX_INLINE_LABELS = 3;

interface CollapsibleToolGroupProps {
  tools: ChatMessage[];
}

export const CollapsibleToolGroup: React.FC<CollapsibleToolGroupProps> = ({ tools }) => {
  const [expanded, setExpanded] = useState(false);

  const labels = tools.map((t) => getHumanReadableToolName((t.value as ToolMessageValue).toolName));

  const summary =
    labels.length <= MAX_INLINE_LABELS
      ? labels.join(", ")
      : `Used ${labels.length} tools`;

  return (
    <div className="tool-group">
      <button
        className="tool-group__toggle"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <AngleRightIcon
          className={`tool-group__chevron ${expanded ? "tool-group__chevron--open" : ""}`}
        />
        <span className="tool-group__summary">{summary}</span>
      </button>
      {expanded && (
        <div className="tool-group__detail">
          {tools.map((t) => {
            const val = t.value as ToolMessageValue;
            return (
              <ToolMessage
                key={t.messageToken}
                toolName={val.toolName}
                status="succeeded"
                detail={val.detail}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default React.memo(ToolMessage);
