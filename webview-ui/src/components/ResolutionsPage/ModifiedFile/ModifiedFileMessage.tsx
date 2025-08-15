import React, { useState } from "react";
import { Card, CardBody, Button } from "@patternfly/react-core";
import { ModifiedFileMessageValue, LocalChange } from "@editor-extensions/shared";
import "./modifiedFileMessage.css";
import ModifiedFileModal from "./ModifiedFileModal";
import ModifiedFileHeader from "./ModifiedFileHeader";
import ModifiedFileDiffPreview from "./ModifiedFileDiffPreview";
import ModifiedFileActions from "./ModifiedFileActions";
import { useModifiedFileData, isLocalChange } from "./useModifiedFileData";

interface ModifiedFileMessageProps {
  data: ModifiedFileMessageValue | LocalChange;
  timestamp?: string;
  mode?: "agent" | "non-agent";
  onApply?: (change: LocalChange) => void;
  onReject?: (change: LocalChange) => void;
  onView?: (change: LocalChange) => void;
  onUserAction?: () => void;
}

export const ModifiedFileMessage: React.FC<ModifiedFileMessageProps> = ({
  data,
  timestamp,
  mode = "agent",
  onApply,
  onReject,
  onView,
  onUserAction,
}) => {
  // Use shared data normalization hook
  const normalizedData = useModifiedFileData(data);
  const { path, isNew, isDeleted, diff, status, content, messageToken, fileName } = normalizedData;
  const [actionTaken, setActionTaken] = useState<"applied" | "rejected" | null>(status || null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFileApplied, setIsFileApplied] = useState(false);

  // Function to handle FILE_RESPONSE message posting (agent mode only)
  const postFileResponse = (
    responseId: string,
    messageToken: string,
    path: string,
    content?: string,
  ) => {
    interface FileResponsePayload {
      responseId: string;
      messageToken: string;
      path: string;
      content?: string;
    }
    const payload: FileResponsePayload = {
      responseId,
      messageToken,
      path,
    };

    if (content !== undefined) {
      payload.content = content;
    }

    window.vscode.postMessage({
      type: "FILE_RESPONSE",
      payload,
    });
  };

  const applyFile = (selectedContent?: string) => {
    setActionTaken("applied");
    setIsExpanded(false);

    // Use provided selected content or fall back to full content
    const contentToApply = selectedContent || content;

    if (mode === "agent") {
      // Agent mode: Use FILE_RESPONSE flow for direct file writing
      postFileResponse("apply", messageToken, path, contentToApply);
      // Trigger scroll after action in agent mode
      onUserAction?.();
    } else {
      // Non-agent mode: Use callback flow with modified data
      if (onApply && isLocalChange(data)) {
        // Create modified LocalChange with updated content
        const modifiedChange: LocalChange = { ...data, content: contentToApply };
        onApply(modifiedChange);
      }
    }
  };

  const rejectFile = () => {
    setActionTaken("rejected");
    setIsExpanded(false);

    if (mode === "agent") {
      // Agent mode: Use FILE_RESPONSE flow
      postFileResponse("reject", messageToken, path);
      // Trigger scroll after action in agent mode
      onUserAction?.();
    } else {
      // Non-agent mode: Use callback flow
      if (onReject && isLocalChange(data)) {
        onReject(data);
      }
    }
  };

  const viewFileInVSCode = (filePath: string, fileDiff: string) => {
    if (mode === "agent") {
      // Agent mode: Use SHOW_MAXIMIZED_DIFF message
      interface ShowMaximizedDiffPayload {
        path: string;
        content: string;
        diff: string;
        messageToken: string;
      }
      const payload: ShowMaximizedDiffPayload = {
        path: filePath,
        content: content,
        diff: fileDiff,
        messageToken: messageToken,
      };
      window.vscode.postMessage({
        type: "SHOW_MAXIMIZED_DIFF",
        payload,
      });
    } else {
      // Non-agent mode: Use callback flow
      if (onView && isLocalChange(data)) {
        onView(data);
      }
    }
  };

  const getStartLineFromDiff = (diff: string): number => {
    const lines = diff.split("\n");
    for (const line of lines) {
      if (line.startsWith("@@")) {
        const m = line.match(/^@@\s+-(\d+),?(\d*)\s+\+(\d+),?(\d*)\s+@@/);
        if (m) {
          const oldStart = parseInt(m[1], 10);
          // Unified diff headers are 1-based; VS Code lines are 0-based
          return Math.max(0, (isNaN(oldStart) ? 1 : oldStart) - 1);
        }
      }
    }
    // Fallback to 0 if header not found
    return 0;
  };

  const viewFileWithDecorations = (filePath: string, fileDiff: string) => {
    // Prevent multiple applications
    if (isFileApplied) {
      return;
    }
    
    setIsFileApplied(true);
    
    // Try using streaming diff first for better performance
    if (mode === "agent") {
      try {
        const startLine = getStartLineFromDiff(fileDiff);
        // Start streaming diff for real-time updates
        window.vscode.postMessage({
          type: "START_STREAMING_DIFF",
          payload: {
            path: filePath,
            startLine,
          },
        });
        
        // Parse diff and stream lines individually
        const diffLines = parseDiffToLines(fileDiff);
        
        if (diffLines.length === 0) {
          console.warn("No valid diff lines found, falling back to static diff");
          fallbackToStaticDiff(filePath, fileDiff);
          return;
        }
        
        // Stream lines with error handling
        diffLines.forEach((diffLine, index) => {
          // Delay each line slightly to simulate streaming
          setTimeout(() => {
            try {
              window.vscode.postMessage({
                type: "STREAM_DIFF_LINE",
                payload: {
                  path: filePath,
                  diffLine,
                },
              });
            } catch (error) {
              console.error("Error streaming diff line:", error);
              // Fall back to static diff on error
              fallbackToStaticDiff(filePath, fileDiff);
            }
          }, index * 10); // 10ms delay between lines
        });
      } catch (error) {
        console.warn("Failed to parse diff for streaming, falling back to static", error);
        // Fall back to static diff display
        fallbackToStaticDiff(filePath, fileDiff);
      }
    } else {
      // Non-agent mode: use static diff display
      fallbackToStaticDiff(filePath, fileDiff);
    }
  };

  const fallbackToStaticDiff = (filePath: string, fileDiff: string) => {
    interface ShowDiffWithDecoratorsPayload {
      path: string;
      content: string;
      diff: string;
      messageToken: string;
    }
    const payload: ShowDiffWithDecoratorsPayload = {
      path: filePath,
      content: content,
      diff: fileDiff,
      messageToken: messageToken,
    };
    window.vscode.postMessage({
      type: "SHOW_DIFF_WITH_DECORATORS",
      payload,
    });
  };

  // Robust diff parser - converts unified diff to line-by-line format with better edge case handling
  const parseDiffToLines = (diff: string): Array<{ type: "old" | "new" | "same"; line: string }> => {
    const lines = diff.split('\n');
    const diffLines: Array<{ type: "old" | "new" | "same"; line: string }> = [];
    
    let currentHunk: { oldStart: number; oldLines: number; newStart: number; newLines: number } | null = null;
    let hunkLines: Array<{ type: "old" | "new" | "same"; line: string }> = [];
    
    for (const line of lines) {
      if (line.startsWith('@@')) {
        // Parse hunk header: @@ -oldStart,oldLines +newStart,newLines @@
        const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
        if (hunkMatch) {
          // Process previous hunk if exists
          if (currentHunk && hunkLines.length > 0) {
            diffLines.push(...hunkLines);
            hunkLines = [];
          }
          
          currentHunk = {
            oldStart: parseInt(hunkMatch[1]),
            oldLines: parseInt(hunkMatch[2] || '1'),
            newStart: parseInt(hunkMatch[3]),
            newLines: parseInt(hunkMatch[4] || '1')
          };
        }
        continue;
      }
      
      if (!currentHunk) {
        // Skip lines before first hunk
        continue;
      }
      
      // Parse diff line content
      if (line.startsWith('-')) {
        hunkLines.push({ type: "old", line: line.substring(1) });
      } else if (line.startsWith('+')) {
        hunkLines.push({ type: "new", line: line.substring(1) });
      } else if (line.startsWith(' ')) {
        hunkLines.push({ type: "same", line: line.substring(1) });
      } else if (line === '\\ No newline at end of file') {
        // Handle special case for files without trailing newline
        continue;
      }
    }
    
    // Process final hunk
    if (currentHunk && hunkLines.length > 0) {
      diffLines.push(...hunkLines);
    }
    
    // Post-process: combine consecutive old/new pairs that are identical after trimming
    // This matches the logic from myers.ts
    for (let i = 0; i < diffLines.length - 1; i++) {
      if (
        diffLines[i]?.type === "old" &&
        diffLines[i + 1]?.type === "new" &&
        diffLines[i].line.trim() === diffLines[i + 1].line.trim()
      ) {
        diffLines[i] = { type: "same", line: diffLines[i].line };
        diffLines.splice(i + 1, 1);
        i--; // Recheck this position
      }
    }
    
    // Remove trailing empty old lines (like myers.ts does)
    while (
      diffLines.length > 0 &&
      diffLines[diffLines.length - 1].type === "old" &&
      diffLines[diffLines.length - 1].line === ""
    ) {
      diffLines.pop();
    }
    
    return diffLines;
  };

  const handleContinue = () => {
    // Mark as applied to continue the conversation flow
    if (mode === "agent") {
      postFileResponse("apply", messageToken, path, content);
      onUserAction?.();
    } else {
      if (onApply && isLocalChange(data)) {
        const modifiedChange: LocalChange = { ...data, content };
        onApply(modifiedChange);
      }
    }
    setActionTaken("applied");
  };

  const handleExpandToggle = () => {
    setIsExpanded(!isExpanded);
  };

  // Handle quick response actions
  const handleQuickResponse = (responseId: string) => {
    const action = responseId === "apply" ? "applied" : "rejected";
    setActionTaken(action);

    if (mode === "agent") {
      // Agent mode: Use FILE_RESPONSE flow
      const contentToSend = responseId === "apply" ? content : undefined;
      postFileResponse(responseId, messageToken, path, contentToSend);
      // Trigger scroll after action in agent mode
      onUserAction?.();
    } else {
      // Non-agent mode: Use callback flow
      if (isLocalChange(data)) {
        if (responseId === "apply" && onApply) {
          const modifiedChange: LocalChange = { ...data, content };
          onApply(modifiedChange);
        } else if (responseId === "reject" && onReject) {
          onReject(data);
        }
      }
    }
  };

  // Function to open file in VSCode editor
  const openFileInEditor = () => {
    window.vscode.postMessage({
      type: "OPEN_FILE_IN_EDITOR",
      payload: {
        path: path,
      },
    });
  };

  // Render minimized version when action is taken
  if (actionTaken) {
    const canOpenInEditor = !isNew && !isDeleted;

    return (
      <div className="modified-file-message">
        <Card className={`modified-file-card modified-file-minimized status-${actionTaken}`}>
          <CardBody className="modified-file-minimized-body">
            <div className="modified-file-minimized-content">
              <div className="modified-file-minimized-status">
                <span className={`status-badge status-${actionTaken}`}>
                  {actionTaken === "applied" ? "✓ Applied" : "✗ Rejected"}
                </span>
                <span className="modified-file-minimized-filename">
                  {/* {isNew && "🆕 "}
                  {isDeleted && "🗑️ "} */}
                  {fileName}
                </span>
              </div>
              {canOpenInEditor ? (
                <Button
                  variant="link"
                  onClick={openFileInEditor}
                  className="modified-file-minimized-link"
                >
                  Open in Editor
                </Button>
              ) : (
                <span className="modified-file-minimized-disabled">
                  {/* {isNew ? "New file" : isDeleted ? "File deleted" : ""} */}
                </span>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  // Render full version when no action has been taken
  return (
    <>
      <div className="modified-file-message">
        <Card className="modified-file-card">
          <ModifiedFileHeader isNew={isNew} fileName={fileName} timestamp={timestamp} />
          <CardBody>
            <ModifiedFileDiffPreview diff={diff} path={path} />
            <ModifiedFileActions
              actionTaken={actionTaken}
              mode={mode}
              normalizedData={normalizedData}
              onApply={() => applyFile()}
              onReject={rejectFile}
              onView={viewFileInVSCode}
              onViewWithDecorations={viewFileWithDecorations}
              onExpandToggle={handleExpandToggle}
              onQuickResponse={handleQuickResponse}
              isFileApplied={isFileApplied}
              onContinue={handleContinue}
            />
          </CardBody>
        </Card>
      </div>

      {/* Expanded Modal View */}
      <ModifiedFileModal
        isOpen={isExpanded}
        onClose={handleExpandToggle}
        data={data}
        actionTaken={actionTaken}
        onApply={(selectedContent: string) => applyFile(selectedContent)}
        onReject={rejectFile}
        onUserAction={onUserAction}
      />
    </>
  );
};

export default ModifiedFileMessage;
