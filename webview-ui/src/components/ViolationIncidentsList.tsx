import "./violations.css";
import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  Flex,
  Content,
  Card,
  CardBody,
  Button,
  Stack,
  StackItem,
  Label,
  MenuToggle,
  MenuToggleElement,
  CardHeader,
  CardExpandableContent,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  ToolbarGroup,
  ToolbarToggleGroup,
  SearchInput,
  Select,
  SelectList,
  SelectOption,
  EmptyState,
  EmptyStateBody,
  EmptyStateVariant,
} from "@patternfly/react-core";
import { FilterIcon, SortAmountDownIcon, SearchIcon } from "@patternfly/react-icons";
import { Incident, Violation, Severity, ViolationWithID } from "@editor-extensions/shared";
import { IncidentTableGroup } from "./IncidentTable";
import ViolationActionsDropdown from "./ViolationActionsDropdown";
import CubesIcon from "@patternfly/react-icons/dist/esm/icons/cubes-icon";

type SortOption = "description" | "incidentCount" | "severity";

interface ViolationIncidentsListProps {
  isRunning: boolean;
  violations: ViolationWithID[];
  focusedIncident?: Incident | null;
  onIncidentSelect: (incident: Incident) => void;
  onGetSolution: (incidents: Incident[], violation: Violation) => void;
  onGetAllSolutions: (violation) => void;
  onOpenChat?: () => void;
  compact?: boolean;
  expandedViolations: Set<string>;
  setExpandedViolations: React.Dispatch<React.SetStateAction<Set<string>>>;
  workspaceRoot: string;
}

const SORT_STORAGE_KEY = "violationSortOption";

const ViolationIncidentsList: React.FC<ViolationIncidentsListProps> = ({
  violations,
  onIncidentSelect,
  expandedViolations,
  setExpandedViolations,
  onGetSolution,
  workspaceRoot,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const initialSortBy = localStorage?.getItem(SORT_STORAGE_KEY) || "description";
  const [sortBy, setSortBy] = useState<SortOption>(initialSortBy as SortOption);
  const [severityFilter, setSeverityFilter] = useState("");
  const [isSortSelectOpen, setIsSortSelectOpen] = useState(false);
  const [isSeveritySelectOpen, setIsSeveritySelectOpen] = useState(false);

  useEffect(() => {
    localStorage?.setItem(SORT_STORAGE_KEY, sortBy);
  }, [sortBy]);

  const toggleViolation = useCallback(
    (violationId: string) => {
      setExpandedViolations((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(violationId)) {
          newSet.delete(violationId);
        } else {
          newSet.add(violationId);
        }
        return newSet;
      });
    },
    [setExpandedViolations],
  );

  const getHighestSeverity = (incidents: Incident[]): string => {
    const severityOrder: { [key in Severity]: number } = { High: 3, Medium: 2, Low: 1 };
    return incidents.reduce((highest, incident) => {
      const incidentSeverity = incident.severity ?? "Low";
      const currentSeverity = severityOrder[incidentSeverity];
      const highestSeverity = severityOrder[highest];
      return currentSeverity > highestSeverity ? incidentSeverity : highest;
    }, "Low" as Severity);
  };

  const filteredAndSortedViolations = useMemo(() => {
    let result = violations;

    // Apply search filter
    if (searchTerm) {
      const lowercaseSearchTerm = searchTerm.toLowerCase();
      result = result
        .map((violation) => ({
          ...violation,
          incidents: violation.incidents.filter(
            (incident) =>
              incident.message.toLowerCase().includes(lowercaseSearchTerm) ||
              incident.uri.toLowerCase().includes(lowercaseSearchTerm),
          ),
        }))
        .filter(
          (violation) =>
            violation.incidents.length > 0 ||
            violation.description.toLowerCase().includes(lowercaseSearchTerm),
        );
    }

    // Apply severity filter
    if (severityFilter) {
      result = result.filter((violation) => {
        const highestSeverity = getHighestSeverity(violation.incidents).toLowerCase();
        return highestSeverity === severityFilter.toLowerCase();
      });
    }

    // Sort the violations
    result.sort((a, b) => {
      switch (sortBy) {
        case "description":
          return a.description.localeCompare(b.description);
        case "incidentCount":
          return b.incidents.length - a.incidents.length;
        case "severity": {
          const severityOrder = { high: 3, medium: 2, low: 1 };
          const aMaxSeverity = severityOrder[getHighestSeverity(a.incidents).toLowerCase()];
          const bMaxSeverity = severityOrder[getHighestSeverity(b.incidents).toLowerCase()];
          return bMaxSeverity - aMaxSeverity;
        }
        default:
          return 0;
      }
    });

    return result;
  }, [violations, searchTerm, sortBy, severityFilter]);

  const renderViolation = useCallback(
    (violation: ViolationWithID) => {
      const truncateText = (text: string, maxLength: number) => {
        if (text.length <= maxLength) return text;
        return text.slice(0, maxLength) + "...";
      };

      const isExpanded = expandedViolations.has(violation.id);
      const highestSeverity = getHighestSeverity(violation.incidents);
      const truncatedDescription = truncateText(violation.description, 100);

      return (
        <Card isExpanded={isExpanded} isCompact key={violation.id} style={{ marginBottom: "10px" }}>
          <CardHeader
            actions={{
              actions: (
                <ViolationActionsDropdown
                  onGetAllSolutions={() => onGetSolution(violation.incidents ?? [], violation)}
                  fixMessage={
                    violation.incidents?.length === 1
                      ? "Resolve 1 incident within this issue"
                      : `Resolve the ${violation.incidents?.length ?? 0} incidents within this issue`
                  }
                />
              ),
            }}
            onExpand={() => toggleViolation(violation.id)}
          >
            <Content style={{ marginBottom: "5px" }}>{truncatedDescription}</Content>
            <Flex>
              <Label color="blue" isCompact>
                {violation.incidents.length} incidents
              </Label>
              <Label
                color={
                  highestSeverity.toLowerCase() === "high"
                    ? "red"
                    : highestSeverity.toLowerCase() === "medium"
                      ? "orange"
                      : "green"
                }
                isCompact
              >
                {highestSeverity}
              </Label>
            </Flex>
          </CardHeader>
          <CardExpandableContent>
            <CardBody>
              <IncidentTableGroup
                onGetSolution={onGetSolution}
                onIncidentSelect={onIncidentSelect}
                violation={violation}
                workspaceRoot={workspaceRoot}
              />
            </CardBody>
          </CardExpandableContent>
        </Card>
      );
    },
    [expandedViolations, toggleViolation, onGetSolution, onIncidentSelect, workspaceRoot],
  );

  const toggleGroupItems = (
    <React.Fragment>
      <ToolbarItem>
        <SearchInput
          aria-label="Search violations and incidents"
          onChange={(_event, value) => setSearchTerm(value)}
          value={searchTerm}
          onClear={() => setSearchTerm("")}
        />
      </ToolbarItem>
      <ToolbarGroup variant="filter-group">
        <ToolbarItem>
          <Select
            toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
              <MenuToggle
                ref={toggleRef}
                onClick={() => setIsSeveritySelectOpen(!isSeveritySelectOpen)}
                isExpanded={isSeveritySelectOpen}
                style={{ width: "150px" }}
              >
                {severityFilter || "Severity"}
              </MenuToggle>
            )}
            onSelect={(_event, selection) => {
              setSeverityFilter(selection as string);
              setIsSeveritySelectOpen(false);
            }}
            selected={severityFilter}
            isOpen={isSeveritySelectOpen}
            onOpenChange={(isOpen) => setIsSeveritySelectOpen(isOpen)}
          >
            <SelectList>
              {["", "High", "Medium", "Low"].map((option) => (
                <SelectOption key={option} value={option}>
                  {option || "All Severities"}
                </SelectOption>
              ))}
            </SelectList>
          </Select>
        </ToolbarItem>
        <ToolbarItem>
          <Select
            toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
              <MenuToggle
                ref={toggleRef}
                onClick={() => setIsSortSelectOpen(!isSortSelectOpen)}
                isExpanded={isSortSelectOpen}
                style={{ width: "150px" }}
              >
                <SortAmountDownIcon /> {sortBy}
              </MenuToggle>
            )}
            onSelect={(_event, selection) => {
              setSortBy(selection as SortOption);
              setIsSortSelectOpen(false);
            }}
            selected={sortBy}
            isOpen={isSortSelectOpen}
            onOpenChange={(isOpen) => setIsSortSelectOpen(isOpen)}
          >
            <SelectList>
              <SelectOption value="description">Description</SelectOption>
              <SelectOption value="incidentCount">Incident Count</SelectOption>
              <SelectOption value="severity">Severity</SelectOption>
            </SelectList>
          </Select>
        </ToolbarItem>
      </ToolbarGroup>
    </React.Fragment>
  );

  const renderEmptyState = () => {
    const hasFilters = searchTerm || severityFilter;
    return (
      <EmptyState
        variant={EmptyStateVariant.xs}
        icon={CubesIcon}
        className="empty-state-violations"
      >
        <EmptyStateBody>
          {hasFilters ? (
            <>
              No violations match the current filters.
              {searchTerm && <div>Try changing your search term.</div>}
              {severityFilter && <div>Try selecting a different severity level.</div>}
            </>
          ) : (
            "No violations have been detected in your project."
          )}
        </EmptyStateBody>
      </EmptyState>
    );
  };

  return (
    <Stack hasGutter>
      <StackItem>
        <Toolbar id="violation-filter-toolbar" className="pf-m-toggle-group-container">
          <ToolbarContent>
            <ToolbarToggleGroup toggleIcon={<FilterIcon />} breakpoint="xl">
              {toggleGroupItems}
            </ToolbarToggleGroup>
          </ToolbarContent>
        </Toolbar>
      </StackItem>
      <StackItem isFilled>
        {filteredAndSortedViolations.length > 0
          ? filteredAndSortedViolations.map((violation) => renderViolation(violation))
          : renderEmptyState()}
      </StackItem>
    </Stack>
  );
};

export default ViolationIncidentsList;
