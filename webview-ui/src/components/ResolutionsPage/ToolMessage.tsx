import React, { useState } from "react";
import "./toolMessage.css";
import {
  CheckCircleIcon,
  TimesCircleIcon,
  SyncAltIcon,
  FileIcon,
  SearchIcon,
  CodeIcon,
  GitAltIcon,
  CubeIcon,
  PackageIcon,
  DatabaseIcon,
} from "@patternfly/react-icons";
import { ExpandableSection } from "@patternfly/react-core";

interface ToolMessageProps {
  toolName: string;
  status: "succeeded" | "failed" | "running";
  timestamp?: string | Date;
  errorDetails?: string;
}

const getHumanReadableToolName = (toolName: string): string => {
  const toolNameMap: Record<string, string> = {
    // File operations
    writeFile: "Writing file",
    readFile: "Reading file",
    searchFiles: "Searching files",
    listFiles: "Listing files",
    deleteFile: "Deleting file",
    createFile: "Creating file",

    // Code operations
    analyzeCode: "Analyzing code",
    searchCode: "Searching code",
    refactorCode: "Refactoring code",
    formatCode: "Formatting code",

    // Git operations
    gitCommit: "Committing changes",
    gitPush: "Pushing changes",
    gitPull: "Pulling changes",
    gitStatus: "Checking git status",

    // Build/Test operations
    buildProject: "Building project",
    runTests: "Running tests",
    lintCode: "Linting code",

    // Package operations
    installDependencies: "Installing dependencies",
    updateDependencies: "Updating dependencies",
    checkDependencies: "Checking dependencies",

    // Network operations
    searchFqdn: "Searching dependency information",

    // Database operations
    queryDatabase: "Querying database",
    migrateDatabase: "Migrating database",

    // Default fallback
    default: "Processing",
  };

  return toolNameMap[toolName] || toolName;
};

const getToolIcon = (toolName: string, status: string) => {
  // Define a mapping of keywords to icons
  const iconMap: Record<string, React.ComponentType> = {
    file: FileIcon,
    search: SearchIcon,
    code: CodeIcon,
    git: GitAltIcon,
    build: CubeIcon,
    test: CubeIcon,
    lint: CubeIcon,
    dependencies: PackageIcon,
    package: PackageIcon,
    database: DatabaseIcon,
  };

  // Normalize toolName to lowercase and handle camelCase by adding spaces
  const normalizedToolName = toolName
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();

  // Find the matching icon by checking if any key is in the normalized toolName
  let Icon: React.ComponentType<{ className?: string }> | undefined;
  for (const [key, icon] of Object.entries(iconMap)) {
    if (normalizedToolName.includes(key)) {
      Icon = icon;
      break;
    }
  }

  // If no specific icon is found, use status-based default icons
  if (!Icon) {
    if (status === "succeeded") {
      return <CheckCircleIcon className="tool-icon success" />;
    } else if (status === "failed") {
      return <TimesCircleIcon className="tool-icon error" />;
    } else {
      return <SyncAltIcon className="tool-icon running" />;
    }
  }

  // Apply status styling to the category icon
  const className = `tool-icon ${status === "succeeded" ? "success" : status === "failed" ? "error" : "running"}`;
  return <Icon className={className} />;
};

export const ToolMessage: React.FC<ToolMessageProps> = ({ toolName, status, errorDetails }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const humanReadableName = getHumanReadableToolName(toolName);
  const toolIcon = getToolIcon(toolName, status);

  // Show additional details if the tool failed and error details are provided
  const hasAdditionalDetails = status === "failed" && errorDetails;

  const toggleExpand = () => {
    if (hasAdditionalDetails) {
      setIsExpanded(!isExpanded);
    }
  };

  const toolSummary = (
    <div
      className="tool-message-summary"
      role="button"
      aria-expanded={isExpanded}
      aria-controls={`${toolName}-details`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          toggleExpand();
        }
      }}
    >
      {toolIcon}
      <span className="tool-name">{humanReadableName}</span>
      {status !== "running" && <span className="tool-status">{status}</span>}
    </div>
  );

  return (
    <div
      className={`tool-message-container ${hasAdditionalDetails ? "has-details" : ""}`}
      role="region"
      aria-label={`${humanReadableName} tool message`}
    >
      {hasAdditionalDetails ? (
        <ExpandableSection
          toggleContent={toolSummary}
          onToggle={toggleExpand}
          isExpanded={isExpanded}
          className="tool-expandable"
        >
          <div
            id={`${toolName}-details`}
            className="tool-details"
            role="complementary"
            aria-label="Error details"
          >
            {status === "failed" && errorDetails && (
              <div className="tool-error-details">
                <p>Error Details:</p>
                <pre>{errorDetails}</pre>
              </div>
            )}
          </div>
        </ExpandableSection>
      ) : (
        <div className="tool-message-text">{toolSummary}</div>
      )}
    </div>
  );
};

export default React.memo(ToolMessage);
