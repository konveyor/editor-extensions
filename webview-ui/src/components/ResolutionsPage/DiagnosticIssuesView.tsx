import React, { useState, useCallback } from "react";
import "./diagnosticIssuesView.css";

// Import diagnostic types locally since they might not be properly exported from shared
interface DiagnosticIssue {
  id: string;
  message: string;
  uri: string;
  filename: string;
  selected?: boolean;
}

interface DiagnosticSummary {
  summary: string;
  issuesByFile: Record<string, DiagnosticIssue[]>;
  totalIssues: number;
}

interface DiagnosticIssuesViewProps {
  diagnosticSummary: DiagnosticSummary;
  onIssueSelectionChange?: (selectedIssues: DiagnosticIssue[]) => void;
  isProcessing?: boolean;
}

export const DiagnosticIssuesView: React.FC<DiagnosticIssuesViewProps> = ({
  diagnosticSummary,
  onIssueSelectionChange,
  isProcessing = false,
}) => {
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const handleIssueToggle = useCallback(
    (issueId: string) => {
      const newSelected = new Set(selectedIssues);
      if (newSelected.has(issueId)) {
        newSelected.delete(issueId);
      } else {
        newSelected.add(issueId);
      }
      setSelectedIssues(newSelected);

      // Notify parent of selection change
      if (onIssueSelectionChange) {
        const allIssues = Object.values(diagnosticSummary.issuesByFile).flat();
        const selectedIssuesList = allIssues.filter((issue) => newSelected.has(issue.id));
        onIssueSelectionChange(selectedIssuesList);
      }
    },
    [selectedIssues, diagnosticSummary, onIssueSelectionChange],
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
    const allIssues = Object.values(diagnosticSummary.issuesByFile).flat();
    const allIssueIds = new Set(allIssues.map((issue) => issue.id));
    setSelectedIssues(allIssueIds);

    if (onIssueSelectionChange) {
      onIssueSelectionChange(allIssues);
    }
  }, [diagnosticSummary, onIssueSelectionChange]);

  const handleSelectNone = useCallback(() => {
    setSelectedIssues(new Set());

    if (onIssueSelectionChange) {
      onIssueSelectionChange([]);
    }
  }, [onIssueSelectionChange]);

  return (
    <div className="diagnostic-issues-view">
      <div className="diagnostic-header">
        <h3>Diagnostic Issues ({diagnosticSummary.totalIssues} total)</h3>
        <div className="diagnostic-actions">
          <button className="diagnostic-action-btn" onClick={handleSelectAll}>
            Select All
          </button>
          <button className="diagnostic-action-btn" onClick={handleSelectNone}>
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
                      const allSelected = issues.every((issue) => selectedIssues.has(issue.id));
                      if (allSelected) {
                        // Deselect all issues in this file
                        const newSelected = new Set(selectedIssues);
                        issues.forEach((issue) => newSelected.delete(issue.id));
                        setSelectedIssues(newSelected);
                        if (onIssueSelectionChange) {
                          const allIssues = Object.values(diagnosticSummary.issuesByFile).flat();
                          const selectedIssuesList = allIssues.filter((issue) =>
                            newSelected.has(issue.id),
                          );
                          onIssueSelectionChange(selectedIssuesList);
                        }
                      } else {
                        // Select all issues in this file
                        const newSelected = new Set(selectedIssues);
                        issues.forEach((issue) => newSelected.add(issue.id));
                        setSelectedIssues(newSelected);
                        if (onIssueSelectionChange) {
                          const allIssues = Object.values(diagnosticSummary.issuesByFile).flat();
                          const selectedIssuesList = allIssues.filter((issue) =>
                            newSelected.has(issue.id),
                          );
                          onIssueSelectionChange(selectedIssuesList);
                        }
                      }
                    }}
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
            const selectedFiles = Object.entries(diagnosticSummary.issuesByFile).filter(([filename, issues]) => 
              issues.some(issue => selectedIssues.has(issue.id))
            );
            return (
              <div>
                {selectedIssues.size} issue{selectedIssues.size !== 1 ? 's' : ''} selected across {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default DiagnosticIssuesView;
