import React from "react";
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
  const getFileChangeSummary = ({ diff }: LocalChange): string => {
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
        <ListItem key={index}>
          <Flex alignItems={{ default: "alignItemsCenter" }}>
            <FlexItem grow={{ default: "grow" }}>
              <Flex
                alignItems={{ default: "alignItemsCenter" }}
                spaceItems={{ default: "spaceItemsXs" }}
              >
                <FlexItem>
                  <FileIcon className="file-changes-file-icon" />
                  <span className="file-changes-file-name">
                    {path.basename(change.originalUri.fsPath)}
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
                      onClick={() => onFileClick(change)}
                      className="file-changes-action-icon"
                      icon={<EyeIcon color="black" />}
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
