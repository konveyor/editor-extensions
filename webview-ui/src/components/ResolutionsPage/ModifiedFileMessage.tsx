import React, { useState } from "react";
import { Card, CardBody, CardTitle, Button, Flex, FlexItem } from "@patternfly/react-core";
import { CheckCircleIcon, TimesCircleIcon, EyeIcon } from "@patternfly/react-icons";
import { ModifiedFileMessageValue } from "@editor-extensions/shared";
import "./modifiedFileMessage.css";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

interface ModifiedFileMessageProps {
  data: ModifiedFileMessageValue;
  timestamp?: string;
}

export const ModifiedFileMessage: React.FC<ModifiedFileMessageProps> = ({ data, timestamp }) => {
  const { path, isNew, diff } = data;
  const fileName = path.split('/').pop() || path;
  const [actionTaken, setActionTaken] = useState<'applied' | 'rejected' | null>(null);
  
  // Format the timestamp if provided
  const formattedTime = timestamp 
    ? new Date(timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "";

  // Determine language based on file extension
  const getLanguage = (filePath: string) => {
    const ext = filePath.split(".").pop()?.toLowerCase();
    const languageMap: { [key: string]: string } = {
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      py: "python",
      java: "java",
      c: "c",
      cpp: "cpp",
      cs: "csharp",
      go: "go",
      rs: "rust",
      rb: "ruby",
      php: "php",
      swift: "swift",
      kt: "kotlin",
      scala: "scala",
      html: "html",
      css: "css",
      scss: "scss",
      less: "less",
      json: "json",
      xml: "xml",
      yaml: "yaml",
      yml: "yaml",
      md: "markdown",
      sh: "shell",
      bash: "shell",
      zsh: "shell",
      sql: "sql",
      vue: "vue",
      svelte: "svelte",
      astro: "astro",
    };
    return languageMap[ext || ""] || "plaintext";
  };

  // Format the diff for markdown display
  const formatDiffForMarkdown = (diffContent: string, language: string) => {
    // Clean up the diff to make it more readable
    const lines = diffContent.split("\n");
    let formattedDiff = "";
    let inHunk = false;

    for (const line of lines) {
      // Skip diff headers except for the file names
      if (line.startsWith("diff ")) {
        formattedDiff += "# " + line.substring(5) + "\n\n";
        continue;
      }

      if (line.startsWith("index ")) {
        continue;
      }

      if (line.startsWith("--- ") || line.startsWith("+++ ")) {
        continue;
      }

      // Start of a hunk
      if (line.startsWith("@@")) {
        inHunk = true;
        formattedDiff += "\n" + line + "\n";
        continue;
      }

      if (inHunk) {
        formattedDiff += line + "\n";
      }
    }

    // If no content was extracted, provide a message
    if (!formattedDiff) {
      formattedDiff = `// No diff content available for ${fileName}`;
    }

    // Wrap in a code block with the appropriate language
    return "```diff\n" + formattedDiff + "\n```";
  };

  const language = getLanguage(path);
  const markdownContent = formatDiffForMarkdown(diff, language);

  return (
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
          {actionTaken ? (
            <Flex className="modified-file-actions">
              <FlexItem>
                <span>
                  {actionTaken === 'applied' ? 
                    <><CheckCircleIcon color="green" /> Changes applied</> : 
                    <><TimesCircleIcon color="red" /> Changes rejected</>}
                </span>
              </FlexItem>
              <FlexItem>
                <Button 
                  variant="link" 
                  icon={<EyeIcon />}
                  onClick={() => {
                    // View the file in VSCode with decorations
                    window.vscode.postMessage({
                      type: "VIEW_FILE",
                      payload: { 
                        path,
                        change: {
                          originalUri: path,
                          modifiedUri: path,
                          diff: diff,
                          state: "pending"
                        }
                      }
                    });
                  }}
                >
                  View
                </Button>
              </FlexItem>
            </Flex>
          ) : data.quickResponses && data.messageToken ? (
            <Flex className="modified-file-actions">
              {data.quickResponses.map((response) => (
                <FlexItem key={response.id}>
                  <Button 
                    variant="link" 
                    icon={response.id === "apply" ? <CheckCircleIcon color="green" /> : <TimesCircleIcon color="red" />}
                    onClick={() => {
                      setActionTaken(response.id === "apply" ? 'applied' : 'rejected');
                      window.vscode.postMessage({
                        type: "FILE_RESPONSE",
                        payload: { 
                          responseId: response.id,
                          messageToken: data.messageToken,
                          path,
                          content: data.content // Pass the content directly
                        }
                      });
                    }}
                  >
                    {response.content}
                  </Button>
                </FlexItem>
              ))}
              <FlexItem>
                <Button 
                  variant="link" 
                  icon={<EyeIcon />}
                  onClick={() => {
                    // View the file in VSCode with decorations
                    window.vscode.postMessage({
                      type: "VIEW_FILE",
                      payload: { 
                        path,
                        change: {
                          originalUri: path,
                          modifiedUri: path,
                          diff: diff,
                          state: "pending"
                        }
                      }
                    });
                  }}
                >
                  View
                </Button>
              </FlexItem>
            </Flex>
          ) : (
            <Flex className="modified-file-actions">
              <FlexItem>
                <Button 
                  variant="link" 
                  icon={<EyeIcon />}
                  onClick={() => {
                    // View the file in VSCode with decorations
                    window.vscode.postMessage({
                      type: "VIEW_FILE",
                      payload: { 
                        path,
                        change: {
                          originalUri: path,
                          modifiedUri: path,
                          diff: diff,
                          state: "pending"
                        }
                      }
                    });
                  }}
                >
                  View
                </Button>
              </FlexItem>
              <FlexItem>
                <Button 
                  variant="link" 
                  icon={<CheckCircleIcon color="green" />}
                  onClick={() => {
                    setActionTaken('applied');
                    // Apply the changes
                    window.vscode.postMessage({
                      type: "APPLY_FILE",
                      payload: { 
                        path,
                        content: data.content, // Pass the content directly
                        messageToken: data.messageToken
                      }
                    });
                  }}
                >
                  Apply
                </Button>
              </FlexItem>
              <FlexItem>
                <Button 
                  variant="link" 
                  icon={<TimesCircleIcon color="red" />}
                  onClick={() => {
                    setActionTaken('rejected');
                    // Reject the changes
                    window.vscode.postMessage({
                      type: "DISCARD_FILE",
                      payload: { 
                        path,
                        messageToken: data.messageToken
                      }
                    });
                  }}
                >
                  Reject
                </Button>
              </FlexItem>
            </Flex>
          )}
        </CardBody>
      </Card>
    </div>
  );
};

export default ModifiedFileMessage;
