import React, { useState, useCallback } from "react";
import { DiagnosticIssue, DiagnosticSummary } from "@editor-extensions/shared";
import { Table, Thead, Tr, Th, Tbody, Td, ExpandableRowContent } from "@patternfly/react-table";
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
  Checkbox,
} from "@patternfly/react-core";
import FileIcon from "@patternfly/react-icons/dist/esm/icons/file-icon";
import ExclamationTriangleIcon from "@patternfly/react-icons/dist/esm/icons/exclamation-triangle-icon";

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
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

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

  const toggleFileExpansion = useCallback((filename: string) => {
    setExpandedFiles((prev) => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(filename)) {
        newExpanded.delete(filename);
      } else {
        newExpanded.add(filename);
      }
      return newExpanded;
    });
  }, []);

  const handleFileCheckChange = useCallback(
    (filename: string, issues: DiagnosticIssue[]) => {
      if (isMessageResponded) {
        return;
      }

      const fileIssueIds = issues.map((issue) => issue.id);
      const allSelected = fileIssueIds.every((id) => selectedIssues.has(id));

      const newSelected = new Set(selectedIssues);
      if (allSelected) {
        fileIssueIds.forEach((id) => newSelected.delete(id));
      } else {
        fileIssueIds.forEach((id) => newSelected.add(id));
      }

      updateSelectedIssues(newSelected);
    },
    [selectedIssues, updateSelectedIssues, isMessageResponded],
  );

  const handleIssueCheckChange = useCallback(
    (issueId: string) => {
      if (isMessageResponded) {
        return;
      }

      const newSelected = new Set(selectedIssues);
      if (newSelected.has(issueId)) {
        newSelected.delete(issueId);
      } else {
        newSelected.add(issueId);
      }
      updateSelectedIssues(newSelected);
    },
    [selectedIssues, updateSelectedIssues, isMessageResponded],
  );

  // Check if all issues in a file are selected
  const areAllFileIssuesSelected = (issues: DiagnosticIssue[]) => {
    return issues.every((issue) => selectedIssues.has(issue.id));
  };

  const areSomeFileIssuesSelected = (issues: DiagnosticIssue[]) => {
    return issues.some((issue) => selectedIssues.has(issue.id));
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
          <Table aria-label="Diagnostic issues table" variant="compact">
            <Thead>
              <Tr>
                <Th width={10}></Th>
                <Th width={10}></Th>
                <Th width={60}>File / Issue</Th>
                <Th width={30}>Count</Th>
              </Tr>
            </Thead>
            <Tbody>
              {Object.entries(diagnosticSummary.issuesByFile).map(([filename, issues]) => {
                const isExpanded = expandedFiles.has(filename);
                const allSelected = areAllFileIssuesSelected(issues);
                const someSelected = areSomeFileIssuesSelected(issues);

                return (
                  <React.Fragment key={filename}>
                    <Tr>
                      <Td
                        expand={{
                          rowIndex: 0,
                          isExpanded,
                          onToggle: () => toggleFileExpansion(filename),
                        }}
                      />
                      <Td>
                        <Checkbox
                          id={`file-checkbox-${filename}`}
                          isChecked={someSelected ? null : allSelected}
                          onChange={() => handleFileCheckChange(filename, issues)}
                          isDisabled={isMessageResponded}
                        />
                      </Td>
                      <Td>
                        <Flex
                          alignItems={{ default: "alignItemsCenter" }}
                          spaceItems={{ default: "spaceItemsSm" }}
                        >
                          <FlexItem>
                            <FileIcon />
                          </FlexItem>
                          <FlexItem>
                            <Button
                              variant="link"
                              isInline
                              onClick={() => issues[0]?.uri && handleFileClick(issues[0].uri)}
                            >
                              {filename}
                            </Button>
                          </FlexItem>
                        </Flex>
                      </Td>
                      <Td>{issues.length} issues</Td>
                    </Tr>
                    {isExpanded && (
                      <Tr isExpanded>
                        <Td colSpan={4} noPadding>
                          <ExpandableRowContent>
                            <Table variant="compact" borders={false}>
                              <Tbody>
                                {issues.map((issue) => (
                                  <Tr key={issue.id}>
                                    <Td width={10}></Td>
                                    <Td width={10}>
                                      <Checkbox
                                        id={`issue-checkbox-${issue.id}`}
                                        isChecked={selectedIssues.has(issue.id)}
                                        onChange={() => handleIssueCheckChange(issue.id)}
                                        isDisabled={isMessageResponded}
                                      />
                                    </Td>
                                    <Td>
                                      <Flex
                                        alignItems={{ default: "alignItemsCenter" }}
                                        spaceItems={{ default: "spaceItemsSm" }}
                                      >
                                        <FlexItem>
                                          <ExclamationTriangleIcon color="var(--pf-global--warning-color--100)" />
                                        </FlexItem>
                                        <FlexItem>{issue.message}</FlexItem>
                                      </Flex>
                                    </Td>
                                    <Td></Td>
                                  </Tr>
                                ))}
                              </Tbody>
                            </Table>
                          </ExpandableRowContent>
                        </Td>
                      </Tr>
                    )}
                  </React.Fragment>
                );
              })}
            </Tbody>
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
