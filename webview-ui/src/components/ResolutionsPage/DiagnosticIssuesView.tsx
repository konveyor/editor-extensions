import React, { useState, useCallback } from "react";
import { DiagnosticIssue, DiagnosticSummary } from "@editor-extensions/shared";
import { Table, Thead, Tr, Th, Tbody, Td, TreeRowWrapper, TdProps } from "@patternfly/react-table";
import {
  Button,
  Flex,
  FlexItem,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  EmptyState,
  EmptyStateBody,
  Title,
} from "@patternfly/react-core";
import FileIcon from "@patternfly/react-icons/dist/esm/icons/file-icon";
import FolderIcon from "@patternfly/react-icons/dist/esm/icons/folder-icon";
import FolderOpenIcon from "@patternfly/react-icons/dist/esm/icons/folder-open-icon";
import ExclamationTriangleIcon from "@patternfly/react-icons/dist/esm/icons/exclamation-triangle-icon";

interface DiagnosticTreeNode {
  id: string;
  name: string;
  type: "file" | "issue";
  message?: string;
  uri?: string;
  file?: string;
  children?: DiagnosticTreeNode[];
  issue?: DiagnosticIssue;
}

interface DiagnosticIssuesViewProps {
  diagnosticSummary: DiagnosticSummary;
  onIssueSelectionChange?: (selectedIssues: DiagnosticIssue[]) => void;
  isMessageResponded?: boolean;
}

export const DiagnosticIssuesView: React.FC<DiagnosticIssuesViewProps> = ({
  diagnosticSummary,
  onIssueSelectionChange,
  isMessageResponded = false,
}) => {
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [expandedNodeIds, setExpandedNodeIds] = useState<string[]>([]);

  // Convert diagnostic data to tree structure
  const treeData: DiagnosticTreeNode[] = React.useMemo(() => {
    return Object.entries(diagnosticSummary.issuesByFile).map(([filename, issues]) => ({
      id: `file-${filename}`,
      name: filename,
      type: "file" as const,
      file: filename,
      uri: issues[0]?.uri,
      children: issues.map((issue) => ({
        id: issue.id,
        name: issue.message,
        type: "issue" as const,
        message: issue.message,
        issue: issue,
      })),
    }));
  }, [diagnosticSummary]);

  // Common function to update selected issues and notify parent
  const updateSelectedIssues = useCallback(
    (newSelected: Set<string>) => {
      if (isMessageResponded) {
        return;
      }

      setSelectedIssues(newSelected);

      if (onIssueSelectionChange) {
        const allIssues = Object.values(diagnosticSummary.issuesByFile).flat();
        const selectedIssuesList = allIssues.filter((issue) => newSelected.has(issue.id));
        onIssueSelectionChange(selectedIssuesList);
      }
    },
    [diagnosticSummary, onIssueSelectionChange, isMessageResponded],
  );

  const handleSelectAll = useCallback(() => {
    if (isMessageResponded) {
      return;
    }

    const allIssues = Object.values(diagnosticSummary.issuesByFile).flat();
    const allIssueIds = new Set(allIssues.map((issue) => issue.id));
    updateSelectedIssues(allIssueIds);
  }, [diagnosticSummary, updateSelectedIssues, isMessageResponded]);

  const handleSelectNone = useCallback(() => {
    if (isMessageResponded) {
      return;
    }

    updateSelectedIssues(new Set());
  }, [updateSelectedIssues, isMessageResponded]);

  const handleFileClick = useCallback((uri: string) => {
    window.vscode.postMessage({
      type: "OPEN_FILE",
      payload: {
        file: uri,
        line: 1,
      },
    });
  }, []);

  // Get all descendants of a node
  const getDescendants = (node: DiagnosticTreeNode): DiagnosticTreeNode[] => {
    if (!node.children || !node.children.length) {
      return node.type === "issue" ? [node] : [];
    } else {
      let descendants: DiagnosticTreeNode[] = [];
      node.children.forEach((child) => {
        if (child.type === "issue") {
          descendants.push(child);
        }
        descendants = [...descendants, ...getDescendants(child)];
      });
      return descendants;
    }
  };

  // Check if all/some descendants are selected
  const areAllDescendantsSelected = (node: DiagnosticTreeNode) => {
    const descendants = getDescendants(node);
    return descendants.length > 0 && descendants.every((n) => selectedIssues.has(n.id));
  };

  const areSomeDescendantsSelected = (node: DiagnosticTreeNode) =>
    getDescendants(node).some((n) => selectedIssues.has(n.id));

  const isNodeChecked = (node: DiagnosticTreeNode): boolean | null => {
    if (node.type === "issue") {
      return selectedIssues.has(node.id);
    }

    if (areAllDescendantsSelected(node)) {
      return true;
    }
    if (areSomeDescendantsSelected(node)) {
      return null;
    }
    return false;
  };

  // Render tree rows recursively
  const renderRows = (
    [node, ...remainingNodes]: DiagnosticTreeNode[],
    level = 1,
    posinset = 1,
    rowIndex = 0,
    isHidden = false,
  ): React.ReactNode[] => {
    if (!node) {
      return [];
    }

    const isExpanded = expandedNodeIds.includes(node.id);
    const isChecked = isNodeChecked(node);
    let icon = node.type === "issue" ? <ExclamationTriangleIcon /> : <FileIcon />;

    if (node.type === "file" && node.children) {
      icon = isExpanded ? <FolderOpenIcon /> : <FolderIcon />;
    }

    const treeRow: TdProps["treeRow"] = {
      onCollapse: () => {
        if (node.type === "file") {
          setExpandedNodeIds((prevExpanded) => {
            const otherExpandedNodeIds = prevExpanded.filter((id) => id !== node.id);
            return isExpanded ? otherExpandedNodeIds : [...otherExpandedNodeIds, node.id];
          });
        }
      },
      onCheckChange: (_event: any, isChecking: boolean) => {
        if (isMessageResponded) {
          return;
        }

        if (node.type === "issue") {
          const newSelected = new Set(selectedIssues);
          if (isChecking) {
            newSelected.add(node.id);
          } else {
            newSelected.delete(node.id);
          }
          updateSelectedIssues(newSelected);
        } else if (node.type === "file") {
          const descendants = getDescendants(node);
          const nodeIds = descendants.map((n) => n.id);
          const newSelected = new Set(selectedIssues);

          if (!isChecking) {
            nodeIds.forEach((id) => newSelected.delete(id));
          } else {
            nodeIds.forEach((id) => newSelected.add(id));
          }
          updateSelectedIssues(newSelected);
        }
      },
      rowIndex,
      props: {
        isExpanded,
        isHidden,
        "aria-level": level,
        "aria-posinset": posinset,
        "aria-setsize": node.children ? node.children.length : 0,
        isChecked,
        checkboxId: `checkbox_${node.id}`,
        icon,
      },
    };

    const childRows =
      node.children && node.children.length
        ? renderRows(node.children, level + 1, 1, rowIndex + 1, !isExpanded || isHidden)
        : [];

    return [
      <TreeRowWrapper key={node.id} row={{ props: treeRow?.props }}>
        <Td dataLabel="Name" treeRow={treeRow}>
          {node.type === "file" ? (
            <Button
              variant="link"
              isInline
              onClick={() => node.uri && handleFileClick(node.uri)}
              isDisabled={!node.uri}
            >
              {node.name}
            </Button>
          ) : (
            node.name
          )}
        </Td>
        <Td dataLabel="Type">
          {node.type === "file" ? `${node.children?.length || 0} issues` : "Issue"}
        </Td>
      </TreeRowWrapper>,
      ...childRows,
      ...renderRows(remainingNodes, level, posinset + 1, rowIndex + 1 + childRows.length, isHidden),
    ];
  };

  const selectedCount = selectedIssues.size;
  const selectedFiles = Object.entries(diagnosticSummary.issuesByFile).filter(([, issues]) =>
    issues.some((issue) => selectedIssues.has(issue.id)),
  ).length;

  // Render empty state
  const emptyState = (
    <EmptyState variant="sm">
      <Title headingLevel="h4" size="lg">
        No diagnostic issues found
      </Title>
      <EmptyStateBody>No diagnostic issues were found in the current workspace.</EmptyStateBody>
    </EmptyState>
  );

  // Calculate if all issues are selected
  const allIssuesCount = Object.values(diagnosticSummary.issuesByFile).flat().length;
  const areAllSelected = selectedCount === allIssuesCount && allIssuesCount > 0;
  const areSomeSelected = selectedCount > 0 && selectedCount < allIssuesCount;

  return (
    <div className={isMessageResponded ? "pf-m-disabled" : ""}>
      <Toolbar>
        <ToolbarContent>
          <ToolbarItem>
            <Title headingLevel="h2" size="lg">
              Diagnostic Issues
            </Title>
          </ToolbarItem>
          <ToolbarItem variant="separator" />
          <ToolbarItem>
            <Flex
              spaceItems={{ default: "spaceItemsSm" }}
              alignItems={{ default: "alignItemsCenter" }}
            >
              <FlexItem>
                <input
                  type="checkbox"
                  id="select-all-checkbox"
                  name="select-all"
                  aria-label="Select all issues"
                  checked={areAllSelected}
                  ref={(input) => {
                    if (input) {
                      input.indeterminate = areSomeSelected;
                    }
                  }}
                  onChange={() => {
                    if (areAllSelected || areSomeSelected) {
                      handleSelectNone();
                    } else {
                      handleSelectAll();
                    }
                  }}
                  disabled={isMessageResponded || allIssuesCount === 0}
                />
              </FlexItem>
              <FlexItem>
                <label htmlFor="select-all-checkbox">
                  {selectedCount === 0
                    ? `${allIssuesCount} ${allIssuesCount === 1 ? "issue" : "issues"} available`
                    : `${selectedCount} of ${allIssuesCount} selected`}
                </label>
              </FlexItem>
              {selectedCount > 0 && (
                <FlexItem>
                  <Button
                    variant="link"
                    isInline
                    onClick={handleSelectNone}
                    isDisabled={isMessageResponded}
                  >
                    Clear selection
                  </Button>
                </FlexItem>
              )}
            </Flex>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>

      {allIssuesCount === 0 ? (
        emptyState
      ) : (
        <>
          <Table isTreeTable aria-label="Diagnostic issues tree table" variant="compact">
            <Thead>
              <Tr>
                <Th width={70}>File / Issue</Th>
                <Th width={30}>Type</Th>
              </Tr>
            </Thead>
            <Tbody>{renderRows(treeData)}</Tbody>
          </Table>

          {selectedCount > 0 && (
            <div
              style={{
                marginTop: "var(--pf-global--spacer--md)",
                marginBottom: "var(--pf-global--spacer--md)",
                textAlign: "center",
              }}
            >
              <small>
                {selectedCount} issue{selectedCount !== 1 ? "s" : ""} selected across{" "}
                {selectedFiles} file{selectedFiles !== 1 ? "s" : ""}
              </small>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DiagnosticIssuesView;
