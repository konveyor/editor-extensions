import React, { useState, useEffect } from "react";
import {
  List,
  ListItem,
  Button,
  Flex,
  FlexItem,
  ButtonVariant,
  Tooltip,
  EmptyStateBody,
} from "@patternfly/react-core";
import InlineDiffView from "./InlineDiffView";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  TimesCircleIcon,
  FileIcon,
  EyeIcon,
} from "@patternfly/react-icons";
import { LocalChange } from "@editor-extensions/shared";
import * as path from "path-browserify";
import "./fileChanges.css";

interface FileChangesProps {
  changes: LocalChange[];
  onFileClick: (change: LocalChange) => void;
  onApplyFix?: (change: LocalChange) => void;
  onRejectChanges?: (change: LocalChange) => void;
}

export function FileChanges({
  changes,
  onFileClick,
  onApplyFix = () => {},
  onRejectChanges = () => {},
}: FileChangesProps) {
  // Use the index as part of the selected change state to ensure uniqueness
  const [selectedChangeIndex, setSelectedChangeIndex] = useState<number | null>(null);
  
  // Listen for messages from the extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      
      // Handle FILE_ACTION_FROM_CODE messages
      if (message.type === 'FILE_ACTION_FROM_CODE') {
        const { path, messageToken, action } = message.payload;
        
        // Find the change that matches this path and token
        const matchingChangeIndex = changes.findIndex(change => {
          const changePath = typeof change.originalUri === 'string' 
            ? change.originalUri 
            : change.originalUri.fsPath || '';
          
          return changePath === path && 
                 (!messageToken || change.messageToken === messageToken);
        });
        
        if (matchingChangeIndex !== -1) {
          const matchingChange = changes[matchingChangeIndex];
          
          // Call the appropriate handler based on the action
          if (action === 'applied') {
            onApplyFix(matchingChange);
          } else if (action === 'rejected') {
            onRejectChanges(matchingChange);
          }
        }
      }
    };
    
    // Add event listener
    window.addEventListener('message', handleMessage);
    
    // Clean up
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [changes, onApplyFix, onRejectChanges]);

  // Toggle the inline diff view when clicking the view button
  const handleViewClick = (change: LocalChange, index: number) => {
    // If this change is already selected, close it
    if (selectedChangeIndex === index) {
      setSelectedChangeIndex(null);
    } else {
      // Otherwise, select this change to show its diff
      setSelectedChangeIndex(index);
    }
  };

  const handleCloseInlineDiff = () => {
    setSelectedChangeIndex(null);
  };

  const getFileChangeSummary = ({ diff }: LocalChange): string => {
    if (!diff) {
      return "No diff available";
    }
    
    const lines = diff.split("\n");
    const additions = lines.filter(
      (line) => line.startsWith("+") && !line.startsWith("+++"),
    ).length;
    const deletions = lines.filter(
      (line) => line.startsWith("-") && !line.startsWith("---"),
    ).length;

    return `${additions} addition${additions !== 1 ? "s" : ""}, ${deletions} deletion${deletions !== 1 ? "s" : ""}`;
  };

  return (
    <List isPlain>
      {changes.map((change, index) => (
        <React.Fragment key={index}>
          <ListItem>
            <Flex alignItems={{ default: "alignItemsCenter" }}>
              <FlexItem grow={{ default: "grow" }}>
                <Flex
                  alignItems={{ default: "alignItemsCenter" }}
                  spaceItems={{ default: "spaceItemsXs" }}
                >
                  <FlexItem>
                    <FileIcon className="file-changes-file-icon" />
                    <span className="file-changes-file-name">
                      {path.basename(typeof change.originalUri === 'string' 
                        ? change.originalUri 
                        : change.originalUri.fsPath || '')}
                    </span>
                  </FlexItem>
                  <FlexItem>
                    <ArrowRightIcon className="file-changes-arrow-icon" />
                  </FlexItem>
                  <FlexItem className="file-changes-change-summary">
                    {getFileChangeSummary(change)}
                  </FlexItem>
                </Flex>
              </FlexItem>
              <FlexItem>
                <Flex
                  alignItems={{ default: "alignItemsCenter" }}
                  spaceItems={{ default: "spaceItemsSm" }}
                >
                  <FlexItem>
                    <Tooltip content="View changes">
                      <Button
                        variant={ButtonVariant.plain}
                        onClick={() => {
                          handleViewClick(change, index);
                          // Also send a message to open the file with decorations
                          window.vscode.postMessage({
                            type: "VIEW_FILE",
                            payload: { 
                              path: typeof change.originalUri === 'string' 
                                ? change.originalUri 
                                : change.originalUri.fsPath || '',
                              change: change
                            }
                          });
                        }}
                        className="file-changes-action-icon"
                        icon={<EyeIcon />}
                        aria-label="View changes"
                      />
                    </Tooltip>
                  </FlexItem>
                  <FlexItem>
                    <Tooltip content="Apply changes">
                      <Button
                        variant={ButtonVariant.plain}
                        icon={<CheckCircleIcon color="green" />}
                        onClick={() => onApplyFix(change)}
                        className="file-changes-action-icon"
                        aria-label="Apply fix"
                      />
                    </Tooltip>
                  </FlexItem>
                  <FlexItem>
                    <Tooltip content="Reject changes">
                      <Button
                        variant={ButtonVariant.plain}
                        icon={<TimesCircleIcon color="red" />}
                        onClick={() => onRejectChanges(change)}
                        className="file-changes-action-icon"
                        aria-label="Reject changes"
                      />
                    </Tooltip>
                  </FlexItem>
                </Flex>
              </FlexItem>
            </Flex>
          </ListItem>
          {selectedChangeIndex === index && (
            <ListItem>
              <div className="file-changes-inline-diff">
                <InlineDiffView change={change} onClose={handleCloseInlineDiff} />
              </div>
            </ListItem>
          )}
        </React.Fragment>
      ))}
      {changes.length === 0 && (
        <ListItem>
          <EmptyState>
            <EmptyStateBody>No pending file changes</EmptyStateBody>
          </EmptyState>
        </ListItem>
      )}
    </List>
  );
}

interface EmptyStateProps {
  children: React.ReactNode;
}

const EmptyState: React.FC<EmptyStateProps> = ({ children }) => (
  <div className="pf-v5-u-text-align-center pf-v5-u-color-200 pf-v5-u-py-md">{children}</div>
);
