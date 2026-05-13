import React, { useState } from "react";
import "./toolMessage.css";
import {
  CheckCircleIcon,
  TimesCircleIcon,
  SyncAltIcon,
  AngleRightIcon,
} from "@patternfly/react-icons";
import type { ChatMessage, ToolMessageValue, AgentChatMessage } from "@editor-extensions/shared";

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

export const extractToolContext = (
  args?: Record<string, unknown>,
): { filePath?: string; detail?: string } => {
  if (!args) {
    return {};
  }

  const rawPath = args.path ?? args.file_path ?? args.filename;
  const filePath = typeof rawPath === "string" ? rawPath : undefined;

  const rawCommand = args.command ?? args.cmd;
  const command = typeof rawCommand === "string" ? rawCommand : undefined;

  const rawQuery = args.query ?? args.search ?? args.pattern ?? args.regex;
  const query = typeof rawQuery === "string" ? rawQuery : undefined;

  const parts: string[] = [];
  if (filePath) {
    const basename = filePath.split("/").pop() || filePath;
    parts.push(basename);
  }
  if (command) {
    const truncated = command.length > 60 ? `${command.substring(0, 57)}...` : command;
    parts.push(truncated);
  }
  if (query) {
    const truncated = query.length > 60 ? `${query.substring(0, 57)}...` : query;
    parts.push(truncated);
  }

  return { filePath, detail: parts.length > 0 ? parts.join(" ") : undefined };
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
  hasFailed?: boolean;
}

export const CollapsibleToolGroup: React.FC<CollapsibleToolGroupProps> = ({ tools, hasFailed }) => {
  const [expanded, setExpanded] = useState(false);

  const labels = tools.map((t) => getHumanReadableToolName((t.value as ToolMessageValue).toolName));

  const failedCount = hasFailed
    ? tools.filter((t) => (t.value as ToolMessageValue).toolStatus === "failed").length
    : 0;

  let summary: string;
  if (hasFailed) {
    summary =
      tools.length === 1
        ? "Tool call failed"
        : failedCount === tools.length
          ? `${tools.length} tool calls failed`
          : `${tools.length} tool calls (${failedCount} failed)`;
  } else {
    summary =
      labels.length <= MAX_INLINE_LABELS
        ? labels.join(", ")
        : `Used ${labels.length} tools`;
  }

  return (
    <div className="tool-group">
      <button
        className={`tool-group__toggle ${hasFailed ? "tool-group__toggle--failed" : ""}`}
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <AngleRightIcon
          className={`tool-group__chevron ${expanded ? "tool-group__chevron--open" : ""}`}
        />
        {hasFailed && <TimesCircleIcon className="tool-status-icon tool-status-icon--error" />}
        <span className="tool-group__summary">{summary}</span>
      </button>
      {expanded && (
        <div className="tool-group__detail">
          {tools.map((t) => {
            const val = t.value as ToolMessageValue;
            const status = val.toolStatus === "failed" ? "failed" : "succeeded";
            return (
              <ToolMessage
                key={t.messageToken}
                toolName={val.toolName}
                status={status}
                detail={val.detail}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

interface AgentToolGroupProps {
  tools: AgentChatMessage[];
}

export const AgentToolGroup: React.FC<AgentToolGroupProps> = ({ tools }) => {
  const [expanded, setExpanded] = useState(false);

  const hasRunning = tools.some((t) => t.toolCall?.status === "running");
  const hasFailed = tools.some((t) => t.toolCall?.status === "failed");

  if (hasRunning) {
    const runningCount = tools.filter((t) => t.toolCall?.status === "running").length;
    return (
      <div className="tool-group">
        <div className="tool-indicator tool-indicator--running">
          <SyncAltIcon className="tool-status-icon tool-status-icon--running" />
          <span className="tool-indicator__label">
            {runningCount === 1 ? "Running tool call..." : `Running ${runningCount} tool calls...`}
          </span>
        </div>
      </div>
    );
  }

  const labels = tools.map((t) => getHumanReadableToolName(t.toolCall?.name ?? "Tool call"));
  const failedCount = hasFailed
    ? tools.filter((t) => t.toolCall?.status === "failed").length
    : 0;

  let summary: string;
  if (hasFailed) {
    summary =
      tools.length === 1
        ? "Tool call failed"
        : failedCount === tools.length
          ? `${tools.length} tool calls failed`
          : `${tools.length} tool calls (${failedCount} failed)`;
  } else {
    summary =
      labels.length <= MAX_INLINE_LABELS ? labels.join(", ") : `Used ${labels.length} tools`;
  }

  return (
    <div className="tool-group">
      <button
        className={`tool-group__toggle ${hasFailed ? "tool-group__toggle--failed" : ""}`}
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <AngleRightIcon
          className={`tool-group__chevron ${expanded ? "tool-group__chevron--open" : ""}`}
        />
        {hasFailed && <TimesCircleIcon className="tool-status-icon tool-status-icon--error" />}
        <span className="tool-group__summary">{summary}</span>
      </button>
      {expanded && (
        <div className="tool-group__detail">
          {tools.map((t) => {
            const tc = t.toolCall;
            if (!tc) {
              return null;
            }
            const status = tc.status === "failed" ? "failed" : "succeeded";
            const { detail } = extractToolContext(tc.arguments);
            return (
              <ToolMessage key={t.id} toolName={tc.name} status={status} detail={detail} />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default React.memo(ToolMessage);
