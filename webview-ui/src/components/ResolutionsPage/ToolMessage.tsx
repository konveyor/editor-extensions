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

    // Database operations
    queryDatabase: "Querying database",
    migrateDatabase: "Migrating database",

    // Default fallback
    default: "Processing",
  };

  return toolNameMap[toolName] || toolName;
};

const getToolIcon = (toolName: string, status: string) => {
  // First determine the category of the tool
  let Icon;

  if (toolName.includes("File") || toolName.includes("file")) {
    Icon = FileIcon;
  } else if (toolName.includes("search") || toolName.includes("Search")) {
    Icon = SearchIcon;
  } else if (toolName.includes("Code") || toolName.includes("code")) {
    Icon = CodeIcon;
  } else if (toolName.includes("git") || toolName.includes("Git")) {
    Icon = GitAltIcon;
  } else if (toolName.includes("build") || toolName.includes("test") || toolName.includes("lint")) {
    Icon = CubeIcon;
  } else if (toolName.includes("dependencies") || toolName.includes("package")) {
    Icon = PackageIcon;
  } else if (toolName.includes("database") || toolName.includes("Database")) {
    Icon = DatabaseIcon;
  } else {
    // Default icon based on status
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

export const ToolMessage: React.FC<ToolMessageProps> = ({ toolName, status }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const humanReadableName = getHumanReadableToolName(toolName);
  const toolIcon = getToolIcon(toolName, status);
  
  // For now, we'll just have placeholder content for the expandable section
  // In a real implementation, you would pass additional details as props
  const hasAdditionalDetails = status === "failed"; // Example condition - only failed tools have details
  
  const toggleExpand = () => {
    if (hasAdditionalDetails) {
      setIsExpanded(!isExpanded);
    }
  };

  const toolSummary = (
    <div className="tool-message-summary">
      {toolIcon}
      <span className="tool-name">{humanReadableName}</span>
      {status !== "running" && <span className="tool-status">{status}</span>}
    </div>
  );

  return (
    <div className={`tool-message-container ${hasAdditionalDetails ? 'has-details' : ''}`}>
      {hasAdditionalDetails ? (
        <ExpandableSection 
          toggleContent={toolSummary}
          onToggle={toggleExpand}
          isExpanded={isExpanded}
          className="tool-expandable"
        >
          <div className="tool-details">
            {status === "failed" && (
              <div className="tool-error-details">
                <p>Error details would be shown here.</p>
                <pre>Example error message or stack trace</pre>
              </div>
            )}
          </div>
        </ExpandableSection>
      ) : (
        <div className="tool-message-text">
          {toolSummary}
        </div>
      )}
    </div>
  );
};

export default ToolMessage;
