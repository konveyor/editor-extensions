import React, { useState, useMemo, useEffect } from "react";
import {
  Card,
  CardBody,
  CardTitle,
  Button,
  Flex,
  FlexItem,
  Modal,
  ModalVariant,
  Badge,
  Tooltip,
} from "@patternfly/react-core";
import {
  CheckCircleIcon,
  TimesCircleIcon,
  EyeIcon,
  ExpandIcon,
  CompressIcon,
} from "@patternfly/react-icons";
import { ModifiedFileMessageValue, LocalChange } from "@editor-extensions/shared";
import "./modifiedFileMessage.css";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { parsePatch, applyPatch } from "diff";
import { getLanguageFromExtension } from "../../../../shared/src/utils/languageMapping";



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
  // Helper functions to check data types
  const isModifiedFileMessageValue = (data: any): data is ModifiedFileMessageValue => {
    return "path" in data && typeof data.path === "string";
  };

  const isLocalChange = (data: any): data is LocalChange => {
    return "originalUri" in data;
  };

  // Helper function to determine status from LocalChange state
  const getStatusFromState = (state: string): "applied" | "rejected" | null => {
    if (state === "applied") {
      return "applied";
    } else if (state === "discarded") {
      return "rejected";
    } else {
      return null;
    }
  };

  // Helper function to extract path from LocalChange originalUri
  const getPathFromOriginalUri = (originalUri: string | { fsPath: string }): string => {
    if (typeof originalUri === "string") {
      return originalUri;
    } else {
      return originalUri.fsPath;
    }
  };

  // Consolidated data normalization that extracts all needed properties based on data type
  const normalizedData = useMemo(() => {
    if (isModifiedFileMessageValue(data)) {
      return {
        path: data.path,
        isNew: data.isNew || false,
        diff: data.diff || "",
        status: data.status || null as "applied" | "rejected" | null,
        content: data.content || "",
        messageToken: data.messageToken || "",
        quickResponses: data.quickResponses,
      };
    } else if (isLocalChange(data)) {
      return {
        path: getPathFromOriginalUri(data.originalUri),
        isNew: false,
        diff: data.diff || "",
        status: getStatusFromState(data.state),
        content: data.content || "",
        messageToken: data.messageToken || "",
        quickResponses: undefined,
      };
    }
    
    // Fallback for unknown data types
    return {
      path: "",
      isNew: false,
      diff: "",
      status: null as "applied" | "rejected" | null,
      content: "",
      messageToken: "",
      quickResponses: undefined,
    };
  }, [data]);

  // Extract normalized properties
  const { path, isNew, diff, status, content, messageToken, quickResponses } = normalizedData;

  const fileName =
    path && typeof path === "string" && path.trim() !== ""
      ? path.split("/").pop() || path
      : "Unnamed File";
  const [actionTaken, setActionTaken] = useState<"applied" | "rejected" | null>(status || null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Parse single-file, multi-hunk diff using proper diff library
  const parsedDiff = useMemo(() => {
    if (!diff) return null;
    
    try {
      // Use the proper diff library to parse the patch
      const patches = parsePatch(diff);
      
      if (!patches || patches.length === 0) {
        return null;
      }
      
      // We expect a single file patch since this component handles one file
      const patch = patches[0];
      
      // Transform library hunks into our format with IDs
      const hunks = patch.hunks.map((hunk, index) => ({
        id: `hunk-${index}`,
        hunk: hunk, // Keep the original hunk object for applying changes
        header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        changes: hunk.lines
      }));
      
      return {
        filename: patch.oldFileName || patch.newFileName || '',
        hunks: hunks
      };
    } catch (error) {
      console.error("Error parsing diff:", error);
      return null;
    }
  }, [diff]);

  const parsedHunks = parsedDiff?.hunks || [];

  const [hunkStates, setHunkStates] = useState<Record<string, boolean>>({});

  // Update hunkStates when parsedHunks changes
  useEffect(() => {
    const newHunkStates: Record<string, boolean> = {};
    parsedHunks.forEach(hunk => {
      newHunkStates[hunk.id] = true; // Default to accepted
    });
    setHunkStates(newHunkStates);
  }, [parsedHunks]);

  // Reusable function to handle FILE_RESPONSE message posting
  const postFileResponse = (
    responseId: string,
    messageToken: string,
    path: string,
    content?: string
  ) => {
    if (mode === "agent") {
      const payload: any = {
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



  // Generate content based on hunk selections using proper diff library
  const generateSelectedContent = (): string => {
    // Get the original content from the backend message
    const originalContent = isModifiedFileMessageValue(data) && data.originalContent 
      ? data.originalContent 
      : ""; // fallback for new files or missing data
    
    // The data.content is actually the modified content from the agent
    const modifiedContent = content;
    
    if (!parsedDiff || parsedHunks.length === 0) {
      // No hunks or parsing failed, return the modified content as-is
      return modifiedContent;
    }
    
    try {
      // Hunk-level selection logic
      const noHunksAccepted = parsedHunks.every(hunk => !hunkStates[hunk.id]);
      if (noHunksAccepted) {
        return originalContent; // Return original content unchanged
      }
      
      const allHunksAccepted = parsedHunks.every(hunk => hunkStates[hunk.id]);
      if (allHunksAccepted) {
        // All hunks accepted - return the agent's modified content
        return modifiedContent;
      }
      
      // Partial selection - create a new patch with only selected hunks
      const selectedHunks = parsedHunks.filter(hunk => hunkStates[hunk.id]);
      
      if (selectedHunks.length === 0) {
        return originalContent; // No hunks selected, return original
      }
      
      // For partial selection, we'll reconstruct a patch with only selected hunks
      // and apply it to the original content
      const filename = parsedDiff.filename || path;
      let patchString = `--- a/${filename}\n+++ b/${filename}\n`;
      
      for (const hunk of selectedHunks) {
        patchString += hunk.header + '\n';
        patchString += hunk.changes.join('\n') + '\n';
      }
      
      // Apply the partial patch to the original content
      const partiallyModified = applyPatch(originalContent, patchString);
      
      if (partiallyModified === false) {
        console.error("Failed to apply partial patch, falling back to original content");
        return originalContent;
      }
      
      return partiallyModified;
      
    } catch (error) {
      console.error("Error generating selected content:", error);
      return originalContent || modifiedContent; // Fallback to original, then modified content
    }
  };

  const applyFile = () => {
    const selectedContent = generateSelectedContent();
    setActionTaken("applied");
    setIsExpanded(false);

    postFileResponse("apply", messageToken, path, selectedContent);
    
    if (mode === "non-agent") {
      if (isLocalChange(data) && onApply) {
        onApply(data);
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

  const formattedTime = timestamp
    ? new Date(timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "";

  const getLanguage = (filePath: string): string => {
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    return getLanguageFromExtension(ext);
  };

  const formatDiffForMarkdown = (diffContent: string) => {
    try {
      const lines = diffContent.split("\n");
      let formattedDiff = "";
      let inHunk = false;

      for (const line of lines) {
        if (line.startsWith("diff ")) {
          formattedDiff += "# " + line.substring(5) + "\n\n";
          continue;
        }

        if (line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
          continue;
        }

        if (line.startsWith("@@")) {
          inHunk = true;
          formattedDiff += "\n" + line + "\n";
          continue;
        }

        if (inHunk) {
          formattedDiff += line + "\n";
        }
      }

      if (!formattedDiff) {
        formattedDiff = `// No diff content available for ${fileName}`;
      }

      return "```diff\n" + formattedDiff + "\n```";
    } catch (error) {
      console.error("Error parsing diff content:", error);
      return `// Error parsing diff content for ${fileName}`;
    }
  };

  const language = getLanguage(path);
  const markdownContent = formatDiffForMarkdown(diff);

  const viewFileInVSCode = (filePath: string, fileDiff: string) => {
    if (mode === "agent") {
      window.vscode.postMessage({
        type: "SHOW_MAXIMIZED_DIFF",
        payload: {
          path: filePath,
          content: content,
          diff: fileDiff,
          messageToken: messageToken,
        },
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

  const toggleHunk = (hunkId: string) => {
    setHunkStates(prev => ({
      ...prev,
      [hunkId]: !prev[hunkId]
    }));
  };

  const renderExpandedDiff = () => {
    return (
      <div className="expanded-diff-content">
        {/* Show different views based on number of hunks */}
        {parsedHunks.length <= 1 ? (
          /* Single hunk or no hunks - show full diff */
          <div className="expanded-diff-display">
            <div className="markdown-diff">
              <ReactMarkdown
                rehypePlugins={[
                  rehypeRaw,
                  rehypeSanitize,
                  [
                    rehypeHighlight,
                    {
                      ignoreMissing: true,
                      detect: true,
                      language: language,
                    },
                  ],
                ]}
              >
                {markdownContent}
              </ReactMarkdown>
            </div>
          </div>
        ) : (
          /* Multiple hunks - show individual hunks with controls */
          <div className="diff-hunks-container">
            <p className="diff-explanation">
              This file has <strong>{parsedHunks.length} separate changes</strong>. 
              Review and accept/reject each change individually:
            </p>
            {parsedHunks.map((hunk, index) => (
              <div key={hunk.id} className="diff-hunk">
                <div className="diff-hunk-header">
                  <Flex justifyContent={{ default: "justifyContentSpaceBetween" }}>
                    <FlexItem>
                      <Badge color={hunkStates[hunk.id] ? 'green' : 'red'}>
                        {hunkStates[hunk.id] ? <CheckCircleIcon /> : <TimesCircleIcon />}
                        Change {index + 1} - {hunkStates[hunk.id] ? 'Accepted' : 'Rejected'}
                      </Badge>
                      <span className="hunk-header-text">{hunk.header}</span>
                    </FlexItem>
                    <FlexItem>
                      <Flex>
                        <FlexItem>
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<CheckCircleIcon />}
                            onClick={() => setHunkStates(prev => ({ ...prev, [hunk.id]: true }))}
                            isDisabled={hunkStates[hunk.id] || actionTaken !== null}
                          >
                            Accept
                          </Button>
                        </FlexItem>
                        <FlexItem>
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<TimesCircleIcon />}
                            onClick={() => setHunkStates(prev => ({ ...prev, [hunk.id]: false }))}
                            isDisabled={!hunkStates[hunk.id] || actionTaken !== null}
                          >
                            Reject
                          </Button>
                        </FlexItem>
                      </Flex>
                    </FlexItem>
                  </Flex>
                </div>
                <div className="diff-hunk-content">
                  <ReactMarkdown
                    rehypePlugins={[
                      rehypeRaw,
                      rehypeSanitize,
                      [
                        rehypeHighlight,
                        {
                          ignoreMissing: true,
                          detect: true,
                          language: language,
                        },
                      ],
                    ]}
                  >
                    {`\`\`\`diff\n${hunk.header}\n${hunk.changes.join('\n')}\n\`\`\``}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
            

          </div>
        )}
      </div>
    );
  };

  const renderActionButtons = () => {
    if (actionTaken || status) {
      return (
        <Flex className="modified-file-actions">
          <FlexItem>
            <span>
              {(actionTaken || status) === "applied" ? (
                <>
                  <CheckCircleIcon color="green" /> Changes applied
                </>
              ) : (
                <>
                  <TimesCircleIcon color="red" /> Changes rejected
                </>
              )}
            </span>
          </FlexItem>
        </Flex>
      );
    }

    if (quickResponses && messageToken) {
      return (
        <Flex className="modified-file-actions">
          {quickResponses.map((response) => (
            <FlexItem key={response.id}>
              <Button
                variant="link"
                icon={response.id === "apply" ? <CheckCircleIcon /> : <TimesCircleIcon />}
                className={response.id === "apply" ? "quick-accept-button" : "quick-reject-button"}
                onClick={() => {
                  const action = response.id === "apply" ? "applied" : "rejected";
                  setActionTaken(action);

                  const contentToSend = response.id === "apply" ? generateSelectedContent() : content;
                  postFileResponse(response.id, messageToken, path, contentToSend);
                  
                  if (mode === "non-agent") {
                    if (isLocalChange(data)) {
                      if (response.id === "apply" && onApply) {
                        onApply(data);
                      } else if (response.id === "reject" && onReject) {
                        onReject(data);
                      }
                    }
                  }
                }}
                aria-label={response.id === "apply" ? "Apply changes" : "Reject changes"}
              >
                {response.content}
              </Button>
            </FlexItem>
          ))}
          {!isNew && mode !== "agent" && (
            <FlexItem>
              <Button
                variant="link"
                icon={<EyeIcon />}
                onClick={() => viewFileInVSCode(path, diff)}
                aria-label="View file in VSCode"
              >
                View
              </Button>
            </FlexItem>
          )}
          <FlexItem>
            <Button
              variant="link"
              icon={<ExpandIcon />}
              onClick={handleExpandToggle}
              aria-label="Review changes in detail"
              isDisabled={actionTaken !== null}
            >
              Review Changes
            </Button>
          </FlexItem>
        </Flex>
      );
    }

    return (
      <Flex className="modified-file-actions">
        {!isNew && mode !== "agent" && (
          <FlexItem>
            <Button
              variant="link"
              icon={<EyeIcon />}
              onClick={() => viewFileInVSCode(path, diff)}
              aria-label="View file in VSCode"
            >
              View
            </Button>
          </FlexItem>
        )}
        <FlexItem>
          <Button
            variant="link"
            icon={<ExpandIcon />}
            onClick={handleExpandToggle}
            aria-label="Review changes in detail"
            isDisabled={actionTaken !== null}
          >
            Review Changes
          </Button>
        </FlexItem>
        <FlexItem>
          <Button
            variant="link"
            icon={<CheckCircleIcon />}
            onClick={applyFile}
            aria-label="Accept all changes"
            className="main-accept-button"
          >
            Accept All
          </Button>
        </FlexItem>
        <FlexItem>
          <Button
            variant="link"
            icon={<TimesCircleIcon />}
            onClick={rejectFile}
            aria-label="Reject all changes"
            className="main-reject-button"
          >
            Reject All
          </Button>
        </FlexItem>
      </Flex>
    );
  };

  return (
    <>
      <div className="modified-file-message">
        <Card className="modified-file-card">
          <CardTitle>
            <Flex>
              <FlexItem grow={{ default: "grow" }}>
                {isNew ? "Created file:" : "Modified file:"} <strong>{fileName}</strong>
              </FlexItem>
              {formattedTime && (
                <FlexItem className="modified-file-timestamp">{formattedTime}</FlexItem>
              )}
            </Flex>
          </CardTitle>
          <CardBody>
            <div className="modified-file-diff">
              <div className="markdown-diff">
                <ReactMarkdown
                  rehypePlugins={[
                    rehypeRaw,
                    rehypeSanitize,
                    [
                      rehypeHighlight,
                      {
                        ignoreMissing: true,
                        detect: true,
                        language: language,
                      },
                    ],
                  ]}
                >
                  {markdownContent}
                </ReactMarkdown>
              </div>
            </div>
            {renderActionButtons()}
          </CardBody>
        </Card>
      </div>

      {/* Expanded Modal View */}
      <Modal
        variant={ModalVariant.large}
        isOpen={isExpanded}
        // onClose={handleExpandToggle}
        className="modified-file-modal"
      >
        <div className="expanded-modal-content">
          <div className="modal-custom-header">
            <div className="modal-title-section">
              <h2 className="modal-title">
                {isNew ? "Created file: " : "Modified file: "}
                <span className="modal-filename">{fileName}</span>
              </h2>
            </div>
            <Button
              variant="plain"
              onClick={handleExpandToggle}
              icon={<CompressIcon />}
              className="modal-close-button"
              aria-label="Close modal"
            />
          </div>
          {renderExpandedDiff()}
          <div className="modal-actions">
            <Flex justifyContent={{ default: "justifyContentSpaceBetween" }}>
              <FlexItem>
                {parsedHunks.length > 1 && (
                  <Flex>
                    <FlexItem>
                      <Button
                        variant="primary"
                        onClick={() => {
                          const newStates: Record<string, boolean> = {};
                          parsedHunks.forEach(hunk => {
                            newStates[hunk.id] = true;
                          });
                          setHunkStates(newStates);
                        }}
                        icon={<CheckCircleIcon />}
                        isDisabled={actionTaken !== null}
                        className="accept-all-button"
                      >
                        Accept All Changes
                      </Button>
                    </FlexItem>
                    <FlexItem>
                      <Button
                        variant="danger"
                        onClick={() => {
                          const newStates: Record<string, boolean> = {};
                          parsedHunks.forEach(hunk => {
                            newStates[hunk.id] = false;
                          });
                          setHunkStates(newStates);
                        }}
                        icon={<TimesCircleIcon />}
                        isDisabled={actionTaken !== null}
                        className="reject-all-button"
                      >
                        Reject All Changes
                      </Button>
                    </FlexItem>
                  </Flex>
                )}
              </FlexItem>
              <FlexItem>
                <Flex>
                  <FlexItem>
                    <Button 
                      variant="secondary" 
                      onClick={applyFile}
                      icon={<CheckCircleIcon />}
                      isDisabled={actionTaken !== null}
                      className="accept-file-button"
                    >
                      {(() => {
                        if (parsedHunks.length <= 1) return "Accept File";
                        const acceptedCount = parsedHunks.filter(hunk => hunkStates[hunk.id]).length;
                        const totalCount = parsedHunks.length;
                        if (acceptedCount === totalCount) return "Accept File";
                        if (acceptedCount === 0) return "Keep Original";
                        return `Accept ${acceptedCount} of ${totalCount} Changes`;
                      })()}
                    </Button>
                  </FlexItem>
                  <FlexItem>
                    <Button 
                      variant="secondary" 
                      onClick={rejectFile}
                      icon={<TimesCircleIcon />}
                      isDisabled={actionTaken !== null}
                      className="reject-file-button"
                    >
                      Reject File
                    </Button>
                  </FlexItem>
                </Flex>
              </FlexItem>
            </Flex>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default ModifiedFileMessage;
