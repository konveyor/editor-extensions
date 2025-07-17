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
  const normalizedData = useModifiedFileData(data);
  const { path, isNew, diff, status, content, messageToken, fileName } = normalizedData;
  const [actionTaken, setActionTaken] = useState<"applied" | "rejected" | null>(status || null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Function to handle FILE_RESPONSE message posting (agent mode only)
  const postFileResponse = (
    responseId: string,
    messageToken: string,
    path: string,
    content?: string,
  ) => {
    console.log("ModifiedFileMessage: postFileResponse called");
    console.log("ModifiedFileMessage: responseId:", responseId);
    console.log("ModifiedFileMessage: messageToken:", messageToken);
    console.log("ModifiedFileMessage: path:", path);
    console.log("ModifiedFileMessage: content length:", content?.length || 'undefined');
    console.log("ModifiedFileMessage: content preview:", content?.substring(0, 100));
    
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
      console.log("ModifiedFileMessage: payload includes content");
    } else {
      console.log("ModifiedFileMessage: payload does NOT include content");
    }

    console.log("ModifiedFileMessage: posting message to VSCode");
    window.vscode.postMessage({
      type: "FILE_RESPONSE",
      payload,
    });
  };

  const applyFile = (selectedContent?: string) => {
    console.log("ModifiedFileMessage: applyFile called");
    console.log("ModifiedFileMessage: selectedContent length:", selectedContent?.length || 'undefined');
    console.log("ModifiedFileMessage: original content length:", content?.length || 'undefined');
    console.log("ModifiedFileMessage: selectedContent preview:", selectedContent?.substring(0, 100));
    console.log("ModifiedFileMessage: original content preview:", content?.substring(0, 100));
    
    setActionTaken("applied");
    setIsExpanded(false);

    // Use provided selected content or fall back to full content
    const contentToApply = selectedContent || content;
    console.log("ModifiedFileMessage: contentToApply length:", contentToApply?.length || 'undefined');
    console.log("ModifiedFileMessage: using selectedContent:", selectedContent !== undefined);

    if (mode === "agent") {
      // Agent mode: Use FILE_RESPONSE flow for direct file writing
      console.log("ModifiedFileMessage: posting FILE_RESPONSE with content");
      postFileResponse("apply", messageToken, path, contentToApply);
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
