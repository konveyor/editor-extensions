import React, { useState, useCallback } from "react";
import "./diagnosticIssuesView.css";
import { DiagnosticIssue, DiagnosticSummary } from "@editor-extensions/shared";

interface DiagnosticIssuesViewProps {
  diagnosticSummary: DiagnosticSummary;
  onIssueSelectionChange?: (selectedIssues: DiagnosticIssue[]) => void;
  isMessageResponded?: boolean;
}

export const DiagnosticIssuesView: React.FC<DiagnosticIssuesViewProps> = ({
  diagnosticSummary,
  onIssueSelectionChange,
  isMessageResponded = false,
}) => {
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  // Common function to update selected issues and notify parent
  const updateSelectedIssues = useCallback(
    (newSelected: Set<string>) => {
      // Don't allow selection changes when message has been responded to
      if (isMessageResponded) {
        return;
      }

      setSelectedIssues(newSelected);

      if (onIssueSelectionChange) {
        const allIssues = Object.values(diagnosticSummary.issuesByFile).flat();
        const selectedIssuesList = allIssues.filter((issue) => newSelected.has(issue.id));
        onIssueSelectionChange(selectedIssuesList);
      }
    },
    [diagnosticSummary, onIssueSelectionChange, isMessageResponded],
  );

  const handleIssueToggle = useCallback(
    (issueId: string) => {
      // Don't allow selection changes when message has been responded to
      if (isMessageResponded) {
        return;
      }

      const newSelected = new Set(selectedIssues);
      if (newSelected.has(issueId)) {
        newSelected.delete(issueId);
      } else {
        newSelected.add(issueId);
      }
      updateSelectedIssues(newSelected);
    },
    [selectedIssues, updateSelectedIssues, isMessageResponded],
  );

  const handleFileToggle = useCallback(
    (filename: string) => {
      const newExpanded = new Set(expandedFiles);
      if (newExpanded.has(filename)) {
        newExpanded.delete(filename);
      } else {
        newExpanded.add(filename);
      }
      setExpandedFiles(newExpanded);
    },
    [expandedFiles],
  );

  const handleFileClick = useCallback((filename: string, issues: DiagnosticIssue[]) => {
    // Open the file directly in VSCode
    const firstIssue = issues[0];
    if (firstIssue) {
      window.vscode.postMessage({
        type: "OPEN_FILE",
        payload: {
          file: firstIssue.uri,
          line: 1, // Default to line 1, could be enhanced to find the specific line with the issue
        },
      });
    }
  }, []);

  const handleSelectAll = useCallback(() => {
    // Don't allow selection changes when message has been responded to
    if (isMessageResponded) {
      return;
    }

    const allIssues = Object.values(diagnosticSummary.issuesByFile).flat();
    const allIssueIds = new Set(allIssues.map((issue) => issue.id));
    updateSelectedIssues(allIssueIds);
  }, [diagnosticSummary, updateSelectedIssues, isMessageResponded]);

  const handleSelectNone = useCallback(() => {
    // Don't allow selection changes when message has been responded to
    if (isMessageResponded) {
      return;
    }

    updateSelectedIssues(new Set());
  }, [updateSelectedIssues, isMessageResponded]);

  return (
    <div className={`diagnostic-issues-view ${isMessageResponded ? "processing" : ""}`}>
      <div className="diagnostic-header">
        <h3>Diagnostic Issues ({diagnosticSummary.totalIssues} total)</h3>
        <div className="diagnostic-actions">
          <button
            className="diagnostic-action-btn"
            onClick={handleSelectAll}
            disabled={isMessageResponded}
          >
            Select All
          </button>
          <button
            className="diagnostic-action-btn"
            onClick={handleSelectNone}
            disabled={isMessageResponded}
          >
            Select None
          </button>
        </div>
      </div>

      <div className="diagnostic-files">
        {Object.entries(diagnosticSummary.issuesByFile).map(([filename, issues]) => (
          <div key={filename} className="diagnostic-file">
            <div className="file-header">
              <div className="file-info">
                <button
                  className="file-toggle-btn"
                  onClick={() => handleFileToggle(filename)}
                  aria-expanded={expandedFiles.has(filename)}
                >
                  <span className="toggle-icon">{expandedFiles.has(filename) ? "▼" : "▶"}</span>
                </button>
                <label className="file-checkbox">
                  <input
                    type="checkbox"
                    checked={issues.every((issue) => selectedIssues.has(issue.id))}
                    onChange={() => {
                      // Don't allow selection changes when message has been responded to
                      if (isMessageResponded) {
                        return;
                      }

                      const allSelected = issues.every((issue) => selectedIssues.has(issue.id));
                      const newSelected = new Set(selectedIssues);

                      if (allSelected) {
                        // Deselect all issues in this file
                        issues.forEach((issue) => newSelected.delete(issue.id));
                      } else {
                        // Select all issues in this file
                        issues.forEach((issue) => newSelected.add(issue.id));
                      }

                      updateSelectedIssues(newSelected);
                    }}
                    disabled={isMessageResponded}
                  />
                  <button
                    className="filename-btn"
                    onClick={() => handleFileClick(filename, issues)}
                    title="Open file in editor"
                  >
                    <span className="filename">{filename}</span>
                    <span className="issue-count">({issues.length} issues)</span>
                  </button>
                </label>
              </div>
              <button
                className="file-view-btn"
                onClick={() => handleFileToggle(filename)}
                title="View all issues in this file"
              >
                View All
              </button>
            </div>

            {expandedFiles.has(filename) && (
              <div className="file-issues">
                {issues.map((issue) => (
                  <div key={issue.id} className="issue-item">
                    <label className="issue-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedIssues.has(issue.id)}
                        onChange={() => handleIssueToggle(issue.id)}
                        disabled={isMessageResponded}
                      />
                      <span className="issue-message">{issue.message}</span>
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {selectedIssues.size > 0 && (
        <div className="selection-summary">
          {(() => {
            const selectedFiles = Object.entries(diagnosticSummary.issuesByFile).filter(
              ([filename, issues]) => issues.some((issue) => selectedIssues.has(issue.id)),
            );
            return (
              <div>
                {selectedIssues.size} issue{selectedIssues.size !== 1 ? "s" : ""} selected across{" "}
                {selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default DiagnosticIssuesView;