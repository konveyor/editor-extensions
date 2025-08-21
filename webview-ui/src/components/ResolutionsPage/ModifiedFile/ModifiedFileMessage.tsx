import React, { useState, useEffect } from "react";
import { Card, CardBody, Button } from "@patternfly/react-core";
import { ModifiedFileMessageValue, LocalChange, ChatMessageType } from "@editor-extensions/shared";
import "./modifiedFileMessage.css";
import ModifiedFileHeader from "./ModifiedFileHeader";
import ModifiedFileDiffPreview from "./ModifiedFileDiffPreview";
import ModifiedFileActions from "./ModifiedFileActions";
import { useModifiedFileData } from "./useModifiedFileData";
import { useExtensionStateContext } from "../../../context/ExtensionStateContext";

interface ModifiedFileMessageProps {
  data: ModifiedFileMessageValue | LocalChange;
  timestamp?: string;
  onUserAction?: () => void;
}

export const ModifiedFileMessage: React.FC<ModifiedFileMessageProps> = ({
  data,
  timestamp,
  onUserAction,
}) => {
  // Use shared data normalization hook
  const normalizedData = useModifiedFileData(data);
  const { path, isNew, isDeleted, diff, status, content, messageToken, fileName } = normalizedData;
  const [isViewingDiff, setIsViewingDiff] = useState(false);

  // Get extension state to check for active decorators
  const { state } = useExtensionStateContext();
  const hasActiveDecorators = !!(state.activeDecorators && state.activeDecorators[messageToken]);

  // Get status from global state as fallback
  const currentMessage = state.chatMessages.find((msg) => msg.messageToken === messageToken);
  const globalStatus =
    currentMessage?.kind === ChatMessageType.ModifiedFile
      ? (currentMessage.value as any)?.status
      : null;

  const [actionTaken, setActionTaken] = useState<"applied" | "rejected" | "processing" | null>(
    () => {
      if (status === "applied" || globalStatus === "applied") {
        return "applied";
      }
      if (status === "rejected" || globalStatus === "rejected") {
        return "rejected";
      }
      return null; // for "pending" or undefined
    },
  );

  // Use global state as fallback when local state is null
  const effectiveActionTaken =
    actionTaken ||
    (globalStatus === "applied" ? "applied" : globalStatus === "rejected" ? "rejected" : null);

  // Update local state when global state changes
  useEffect(() => {
    if (globalStatus === "applied" || globalStatus === "rejected") {
      setActionTaken(globalStatus);
    }
  }, [globalStatus]);

  // Clear viewing diff state when status is finalized
  useEffect(() => {
    if (effectiveActionTaken !== null && effectiveActionTaken !== "processing") {
      setIsViewingDiff(false);
    }
  }, [effectiveActionTaken]);

  // Function to handle FILE_RESPONSE message posting
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

  const applyFileChanges = (selectedContent?: string) => {
    setIsViewingDiff(false);
    setActionTaken("applied");

    // Use provided selected content or fall back to full content
    const contentToApply = selectedContent || content;

    // Use FILE_RESPONSE flow for standalone apply button
    postFileResponse("apply", messageToken, path, contentToApply);
    // Trigger scroll after action
    onUserAction?.();
  };

  const rejectFileChanges = () => {
    setIsViewingDiff(false);
    setActionTaken("rejected");

    // Use FILE_RESPONSE flow for standalone reject button
    postFileResponse("reject", messageToken, path);
    // Trigger scroll after action
    onUserAction?.();
  };

  const viewFileWithDecorations = (filePath: string, fileDiff: string) => {
    if (isViewingDiff) {
      return;
    }

    setIsViewingDiff(true);

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

  const handleContinue = () => {
    // Send CONTINUE_WITH_FILE_STATE message to check current file state
    window.vscode.postMessage({
      type: "CONTINUE_WITH_FILE_STATE",
      payload: {
        messageToken,
        path,
        content,
      },
    });
    // Trigger scroll after action
    onUserAction?.();

    // Keep viewing diff state until backend responds with final status
    // This prevents the UI from reverting to action buttons prematurely
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

  // Render minimized version when any action is taken (including processing)
  if (effectiveActionTaken) {
    const canOpenInEditor = !isNew && !isDeleted;

    return (
      <div className="modified-file-message">
        <Card
          className={`modified-file-card modified-file-minimized status-${effectiveActionTaken}`}
        >
          <CardBody className="modified-file-minimized-body">
            <div className="modified-file-minimized-content">
              <div className="modified-file-minimized-status">
                <span className={`status-badge status-${effectiveActionTaken}`}>
                  {effectiveActionTaken === "applied" ? "✓ Applied" 
                   : effectiveActionTaken === "rejected" ? "✗ Rejected"
                   : "⏳ Processing..."}
                </span>
                <span className="modified-file-minimized-filename">{fileName}</span>
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
                  {isNew ? "New file" : isDeleted ? "File deleted" : ""}
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
              actionTaken={effectiveActionTaken}
              normalizedData={normalizedData}
              onApply={() => applyFileChanges()}
              onReject={rejectFileChanges}
              onViewWithDecorations={viewFileWithDecorations}
              isViewingDiff={isViewingDiff}
              onContinue={handleContinue}
              onSetActionTaken={setActionTaken}
              hasActiveDecorators={hasActiveDecorators}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
};

export default ModifiedFileMessage;
