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
} from "@patternfly/react-core";
import {
  CheckCircleIcon,
  TimesCircleIcon,
  EyeIcon,
  ExpandIcon,
  CompressIcon,
  PlusCircleIcon,
  MinusCircleIcon,
  CheckIcon,
  CloseIcon,
} from "@patternfly/react-icons";
import { ModifiedFileMessageValue, LocalChange } from "@editor-extensions/shared";
import "./modifiedFileMessage.css";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { parsePatch, applyPatch } from "diff";
import { getLanguageFromExtension } from "../../../../shared/src/utils/languageMapping";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";
import "highlight.js/styles/github-dark.css";

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
        status: data.status || (null as "applied" | "rejected" | null),
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
    if (!diff) {
      return null;
    }

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
        changes: hunk.lines,
      }));

      return {
        filename: patch.oldFileName || patch.newFileName || "",
        hunks: hunks,
      };
    } catch (error) {
      // Silently handle diff parsing errors and return null
      return null;
    }
  }, [diff]);

  const parsedHunks = parsedDiff?.hunks || [];

  const [hunkStates, setHunkStates] = useState<Record<string, boolean>>({});

  // Configure highlight.js
  useEffect(() => {
    hljs.configure({
      ignoreUnescapedHTML: true,
      languages: [
        "javascript",
        "typescript",
        "java",
        "python",
        "css",
        "html",
        "xml",
        "json",
        "yaml",
        "properties",
        "groovy",
        "xml",
      ],
    });
  }, []);

  // Update hunkStates when parsedHunks changes
  useEffect(() => {
    const newHunkStates: Record<string, boolean> = {};
    parsedHunks.forEach((hunk) => {
      newHunkStates[hunk.id] = true; // Default to accepted
    });
    setHunkStates(newHunkStates);
  }, [parsedHunks]);

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

  // Generate content based on hunk selections using proper diff library
  const generateSelectedContent = (): string => {
    try {
      // Get the original content from the backend message
      const originalContent =
        isModifiedFileMessageValue(data) && data.originalContent ? data.originalContent : ""; // fallback for new files or missing data

      // The data.content is actually the modified content from the agent
      const modifiedContent = content;

      if (!parsedDiff || parsedHunks.length === 0) {
        console.warn("No parsed diff or hunks available, returning modified content as-is", {
          hasParsedDiff: !!parsedDiff,
          hunksLength: parsedHunks.length,
          path,
        });
        return modifiedContent;
      }

      // Hunk-level selection logic
      const noHunksAccepted = parsedHunks.every((hunk) => !hunkStates[hunk.id]);
      if (noHunksAccepted) {
        console.log("No hunks accepted, returning original content unchanged", {
          totalHunks: parsedHunks.length,
          path,
        });
        return originalContent; // Return original content unchanged
      }

      const allHunksAccepted = parsedHunks.every((hunk) => hunkStates[hunk.id]);
      if (allHunksAccepted) {
        console.log("All hunks accepted, returning agent's modified content", {
          totalHunks: parsedHunks.length,
          path,
        });
        return modifiedContent; // All hunks accepted - return the agent's modified content
      }

      // Partial selection - create a new patch with only selected hunks
      const selectedHunks = parsedHunks.filter((hunk) => hunkStates[hunk.id]);

      if (selectedHunks.length === 0) {
        console.warn(
          "No hunks selected despite having hunks available, returning original content",
          {
            totalHunks: parsedHunks.length,
            selectedHunks: selectedHunks.length,
            path,
          },
        );
        return originalContent; // No hunks selected, return original
      }

      console.log("Applying partial patch with selected hunks", {
        totalHunks: parsedHunks.length,
        selectedHunks: selectedHunks.length,
        path,
      });

      // For partial selection, we'll reconstruct a patch with only selected hunks
      // and apply it to the original content
      const filename = parsedDiff.filename || path;
      let patchString = `--- a/${filename}\n+++ b/${filename}\n`;

      try {
        // Build patch string with selected hunks
        for (const hunk of selectedHunks) {
          if (!hunk.header) {
            throw new Error(`Missing header for hunk ${hunk.id}`);
          }
          if (!hunk.changes || !Array.isArray(hunk.changes)) {
            throw new Error(`Invalid changes array for hunk ${hunk.id}`);
          }

          patchString += hunk.header + "\n";
          patchString += hunk.changes.join("\n") + "\n";
        }

        console.log("Successfully constructed patch string", {
          patchLength: patchString.length,
          selectedHunks: selectedHunks.length,
          path,
        });
      } catch (patchConstructionError) {
        const errorMessage =
          patchConstructionError instanceof Error
            ? patchConstructionError.message
            : String(patchConstructionError);
        // Silently handle patch construction errors and re-throw with generic message
        throw new Error(`Failed to construct patch string: ${errorMessage}`);
      }

      // Apply the partial patch to the original content
      let partiallyModified: string | false;
      try {
        partiallyModified = applyPatch(originalContent, patchString);

        if (partiallyModified === false) {
          // Silently handle patch application failure and throw generic error
          throw new Error("applyPatch returned false - patch application failed");
        }

        console.log("Successfully applied partial patch", {
          originalLength: originalContent.length,
          modifiedLength: partiallyModified.length,
          selectedHunks: selectedHunks.length,
          path,
        });

        return partiallyModified;
      } catch (patchApplicationError) {
        const errorMessage =
          patchApplicationError instanceof Error
            ? patchApplicationError.message
            : String(patchApplicationError);
        // Silently handle patch application errors and re-throw with generic message
        throw new Error(`Failed to apply patch: ${errorMessage}`);
      }
    } catch (error) {
      // Silently handle generateSelectedContent errors and continue with fallback strategy

      // Fallback strategy: try to return original content, then modified content
      const originalContent =
        isModifiedFileMessageValue(data) && data.originalContent ? data.originalContent : "";

      if (originalContent) {
        console.log("Falling back to original content due to error");
        return originalContent;
      } else if (content) {
        console.log("Falling back to modified content due to error");
        return content;
      } else {
        // Silently handle case where no fallback content is available
        return "";
      }
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
      // Silently handle diff content parsing errors and return error message
      return `\`\`\`\n// Error parsing diff content for ${fileName}\n\`\`\``;
    }
  };

  const language = getLanguage(path);
  const markdownContent = formatDiffForMarkdown(diff);

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

  const toggleHunk = (hunkId: string) => {
    setHunkStates((prev) => ({
      ...prev,
      [hunkId]: !prev[hunkId],
    }));
  };

  // Helper function to parse and render diff lines with syntax highlighting
  const renderDiffLines = (diffContent: string) => {
    if (!diffContent) {
      return <div className="diff-line context">No diff content available</div>;
    }

    const lines = diffContent.split("\n");
    return lines.map((line, index) => {
      let lineClass = "context";
      let lineNumber = "";
      let content = line;
      let shouldHighlight = false;

      if (line.startsWith("+")) {
        lineClass = "addition";
        lineNumber = "  +";
        content = line.substring(1);
        shouldHighlight = true;
      } else if (line.startsWith("-")) {
        lineClass = "deletion";
        lineNumber = "  -";
        content = line.substring(1);
        shouldHighlight = true;
      } else if (line.startsWith("@@")) {
        lineClass = "meta";
        lineNumber = "  ";
        content = line;
        shouldHighlight = false;
      } else if (
        line.startsWith("diff ") ||
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ")
      ) {
        lineClass = "meta";
        lineNumber = "  ";
        content = line;
        shouldHighlight = false;
      } else if (line.match(/^\d+$/)) {
        // Line numbers
        lineClass = "meta";
        lineNumber = line.padStart(3);
        content = "";
        shouldHighlight = false;
      } else if (line.startsWith(" ")) {
        lineClass = "context";
        lineNumber = "   ";
        content = line.substring(1);
        shouldHighlight = true;
      }

      // Apply syntax highlighting to code content
      let highlightedContent = content;
      if (shouldHighlight && content.trim()) {
        try {
          const fileExtension = path.split(".").pop()?.toLowerCase() || "";
          let language = getLanguageFromExtension(fileExtension);

          // Map common file extensions to highlight.js languages
          const languageMap: Record<string, string> = {
            js: "javascript",
            ts: "typescript",
            jsx: "javascript",
            tsx: "typescript",
            java: "java",
            py: "python",
            css: "css",
            html: "html",
            xml: "xml",
            json: "json",
            yaml: "yaml",
            yml: "yaml",
            properties: "properties",
            gradle: "groovy",
            groovy: "groovy",
            pom: "xml",
            md: "markdown",
          };

          language = languageMap[fileExtension] || language;

          if (language && language !== "text" && hljs.getLanguage(language)) {
            const highlighted = hljs.highlight(content, { language });
            highlightedContent = highlighted.value;
          }
        } catch (error) {
          // Fallback to plain text if highlighting fails
          highlightedContent = content;
        }
      }

      return (
        <div key={index} className={`diff-line ${lineClass}`}>
          <span className="diff-line-number">{lineNumber}</span>
          <span className="diff-content" dangerouslySetInnerHTML={{ __html: highlightedContent }} />
        </div>
      );
    });
  };

  const renderExpandedDiff = () => {
    return (
      <div className="expanded-diff-content">
        {parsedHunks.length <= 1 ? (
          /* Single hunk or no hunks - show enhanced diff */
          <div className="expanded-diff-display">
            <div className="diff-legend">
              <div className="legend-item">
                <div className="legend-color addition"></div>
                <span>Added</span>
              </div>
              <div className="legend-item">
                <div className="legend-color deletion"></div>
                <span>Removed</span>
              </div>
              <div className="legend-item">
                <div className="legend-color context"></div>
                <span>Context</span>
              </div>
            </div>
            {renderDiffLines(diff)}
          </div>
        ) : (
          /* Multiple hunks - show clean hunk selection interface */
          <div className="hunk-selection-interface">
            <div className="hunk-selection-header">
              <h3 className="hunk-selection-title">Review Changes</h3>
              <span className="hunk-count">
                {parsedHunks.length} change{parsedHunks.length !== 1 ? "s" : ""} found
              </span>
            </div>

            {parsedHunks.map((hunk, index) => (
              <div key={hunk.id} className="hunk-item">
                <div className="hunk-item-header">
                  <div className="hunk-info">
                    <span className="hunk-number">Change {index + 1}</span>
                    <span className="hunk-description">{hunk.header}</span>
                  </div>
                  <div className="hunk-controls">
                    <Button
                      variant={hunkStates[hunk.id] ? "primary" : "secondary"}
                      size="sm"
                      icon={<CheckCircleIcon />}
                      onClick={() => setHunkStates((prev) => ({ ...prev, [hunk.id]: true }))}
                      isDisabled={actionTaken !== null}
                    >
                      Accept
                    </Button>
                    <Button
                      variant={!hunkStates[hunk.id] ? "danger" : "secondary"}
                      size="sm"
                      icon={<TimesCircleIcon />}
                      onClick={() => setHunkStates((prev) => ({ ...prev, [hunk.id]: false }))}
                      isDisabled={actionTaken !== null}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
                <div className="hunk-content">
                  <div className="diff-legend">
                    <div className="legend-item">
                      <div className="legend-color addition"></div>
                      <span>Added</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-color deletion"></div>
                      <span>Removed</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-color context"></div>
                      <span>Context</span>
                    </div>
                  </div>
                  {renderDiffLines(hunk.changes.join("\n"))}
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
        <Flex
          className="modified-file-actions"
          justifyContent={{ default: "justifyContentSpaceBetween" }}
        >
          <FlexItem>
            <Flex gap={{ default: "gapMd" }}>
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
          </FlexItem>
          <FlexItem>
            <Flex gap={{ default: "gapMd" }}>
              {quickResponses.map((response) => (
                <FlexItem key={response.id}>
                  <Button
                    variant={response.id === "apply" ? "primary" : "danger"}
                    icon={response.id === "apply" ? <CheckCircleIcon /> : <TimesCircleIcon />}
                    className={
                      response.id === "apply" ? "quick-accept-button" : "quick-reject-button"
                    }
                    onClick={() => {
                      const action = response.id === "apply" ? "applied" : "rejected";
                      setActionTaken(action);

                      const contentToSend =
                        response.id === "apply" ? generateSelectedContent() : content;
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
                    isDisabled={actionTaken !== null}
                  >
                    {response.content}
                  </Button>
                </FlexItem>
              ))}
            </Flex>
          </FlexItem>
        </Flex>
      );
    }

    return (
      <Flex
        className="modified-file-actions"
        justifyContent={{ default: "justifyContentSpaceBetween" }}
      >
        <FlexItem>
          <Flex gap={{ default: "gapMd" }}>
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
        </FlexItem>
        <FlexItem>
          <Flex gap={{ default: "gapMd" }}>
            <FlexItem>
              <Button
                variant="link"
                icon={<CheckCircleIcon />}
                onClick={applyFile}
                aria-label="Accept all changes"
                className="main-accept-button"
                isDisabled={actionTaken !== null}
              >
                Accept All Changes
              </Button>
            </FlexItem>
            <FlexItem>
              <Button
                variant="link"
                icon={<TimesCircleIcon />}
                onClick={rejectFile}
                aria-label="Reject all changes"
                className="main-reject-button"
                isDisabled={actionTaken !== null}
              >
                Reject All Changes
              </Button>
            </FlexItem>
          </Flex>
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
          <div className="modal-custom-header sticky-header">
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
          <div className="modal-content-scrollable">{renderExpandedDiff()}</div>
          <div className="modal-actions">
            <Flex
              justifyContent={{ default: "justifyContentSpaceBetween" }}
              alignItems={{ default: "alignItemsCenter" }}
            >
              <FlexItem>
                <Flex gap={{ default: "gapMd" }}>
                  {parsedHunks.length > 1 && (
                    <>
                      <FlexItem>
                        <Button
                          variant="secondary"
                          icon={<PlusCircleIcon />}
                          onClick={() => {
                            const newStates: Record<string, boolean> = {};
                            parsedHunks.forEach((hunk) => {
                              newStates[hunk.id] = true;
                            });
                            setHunkStates(newStates);
                          }}
                          isDisabled={actionTaken !== null}
                          className="select-all-button"
                        >
                          Select All
                        </Button>
                      </FlexItem>
                      <FlexItem>
                        <Button
                          variant="secondary"
                          icon={<MinusCircleIcon />}
                          onClick={() => {
                            const newStates: Record<string, boolean> = {};
                            parsedHunks.forEach((hunk) => {
                              newStates[hunk.id] = false;
                            });
                            setHunkStates(newStates);
                          }}
                          isDisabled={actionTaken !== null}
                          className="deselect-all-button"
                        >
                          Deselect All
                        </Button>
                      </FlexItem>
                    </>
                  )}
                </Flex>
              </FlexItem>
              <FlexItem>
                <Flex
                  gap={{ default: "gapLg" }}
                  justifyContent={{ default: "justifyContentFlexEnd" }}
                >
                  <FlexItem>
                    <Button
                      variant="plain"
                      icon={<CheckIcon />}
                      onClick={applyFile}
                      isDisabled={actionTaken !== null}
                      className="submit-button"
                      aria-label="Accept changes"
                    >
                      Accept Changes
                    </Button>
                  </FlexItem>
                  <FlexItem>
                    <Button
                      variant="plain"
                      icon={<CloseIcon />}
                      onClick={rejectFile}
                      isDisabled={actionTaken !== null}
                      className="cancel-button"
                      aria-label="reject changes"
                    >
                      Reject changes
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
