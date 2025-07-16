import React, { useState } from "react";
import { Card, CardBody } from "@patternfly/react-core";
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
}

export const ModifiedFileMessage: React.FC<ModifiedFileMessageProps> = ({
  data,
  timestamp,
  mode = "agent",
  onApply,
  onReject,
  onView,
}) => {
  // Use shared data normalization hook
  const { path, isNew, diff, status, content, messageToken, quickResponses, fileName } =
    useModifiedFileData(data);
  const [actionTaken, setActionTaken] = useState<"applied" | "rejected" | null>(status || null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Reusable function to handle FILE_RESPONSE message posting
  const postFileResponse = (
    responseId: string,
    messageToken: string,
    path: string,
    content?: string,
  ) => {
    if (mode === "agent") {
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
    }
  };

  const applyFile = (selectedContent?: string) => {
    setActionTaken("applied");
    setIsExpanded(false);

    // Use provided selected content or fall back to full content
    const contentToApply = selectedContent || content;

    // Main component "Accept All Changes" - use the content directly
    postFileResponse("apply", messageToken, path, contentToApply);

    if (mode === "non-agent") {
      if (isLocalChange(data) && onApply) {
        // Pass the selected content for apply
        const modifiedChange = { ...data, content: contentToApply };
        onApply(modifiedChange);
      }
    }
  };

  const rejectFile = () => {
    setActionTaken("rejected");
    setIsExpanded(false);

    postFileResponse("reject", messageToken, path);

    if (mode === "non-agent") {
      if (isLocalChange(data) && onReject) {
        onReject(data);
      }
    }
  };

  const viewFileInVSCode = (filePath: string, fileDiff: string) => {
    if (mode === "agent") {
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
      if (onView && isLocalChange(data)) {
        onView(data);
      }
    }
  };

  const handleExpandToggle = () => {
    setIsExpanded(!isExpanded);
  };

  // Handle quick response actions
  const handleQuickResponse = (responseId: string) => {
    const action = responseId === "apply" ? "applied" : "rejected";
    setActionTaken(action);

    // Main component: apply=modified content, reject=original content
    const contentToSend = responseId === "apply" ? content : undefined;
    postFileResponse(responseId, messageToken, path, contentToSend);

    if (mode === "non-agent") {
      if (isLocalChange(data)) {
        if (responseId === "apply" && onApply) {
          // Pass the modified content for apply
          const modifiedChange = { ...data, content };
          onApply(modifiedChange);
        } else if (responseId === "reject" && onReject) {
          onReject(data);
        }
      }
    }
  };

  return (
    <>
      <div className="modified-file-message">
        <Card className="modified-file-card">
          <ModifiedFileHeader isNew={isNew} fileName={fileName} timestamp={timestamp} />
          <CardBody>
            <ModifiedFileDiffPreview diff={diff} path={path} />
            <ModifiedFileActions
              actionTaken={actionTaken}
              status={status}
              quickResponses={quickResponses}
              messageToken={messageToken}
              isNew={isNew}
              mode={mode}
              path={path}
              diff={diff}
              content={content}
              data={data}
              onApply={() => applyFile()}
              onReject={rejectFile}
              onView={viewFileInVSCode}
              onExpandToggle={handleExpandToggle}
              onQuickResponse={handleQuickResponse}
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
      />
    </>
  );
};

export default ModifiedFileMessage;
