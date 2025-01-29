import React from "react";
import {
  Toolbar,
  ToolbarItem,
  ToolbarContent,
  ToolbarFilter,
  ToolbarToggleGroup,
  ToolbarGroup,
  Badge,
  MenuToggle,
  MenuToggleElement,
  SearchInput,
  Select,
  SelectList,
  SelectOption,
  Card,
  CardBody,
  CardHeader,
  CardExpandableContent,
  Content,
  Stack,
  StackItem,
  Label,
  Flex,
} from "@patternfly/react-core";
import { FilterIcon } from "@patternfly/react-icons";
import { IncidentTableGroup } from "./IncidentTable";
import * as path from "path-browserify";
import { ViolationWithID, Incident, Severity, Violation } from "@editor-extensions/shared";

interface ViolationIncidentsListProps {
  violations: ViolationWithID[];
  onIncidentSelect: (incident: Incident) => void;
  expandedViolations: Set<string>;
  setExpandedViolations: (value: Set<string>) => void;
  onGetSolution: (incidents: Incident[], violation: ViolationWithID | Violation) => void;
  workspaceRoot: string;
  isRunning: boolean;
}

const ViolationIncidentsList = ({
  violations,
  onIncidentSelect,
  expandedViolations,
  setExpandedViolations,
  onGetSolution,
  workspaceRoot,
  isRunning,
}: ViolationIncidentsListProps) => {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [isSeverityExpanded, setIsSeverityExpanded] = React.useState(false);
  const [isGroupByExpanded, setIsGroupByExpanded] = React.useState(false);
  const [filters, setFilters] = React.useState({
    severity: [] as Severity[],
    groupBy: ["violation"] as string[],
  });

  const onSeveritySelect = (
    _event: React.MouseEvent | undefined,
    value: string | number | undefined,
  ) => {
    if (typeof value === "string") {
      const severity = value as Severity;
      setFilters((prev) => ({
        ...prev,
        severity: prev.severity.includes(severity)
          ? prev.severity.filter((s) => s !== severity)
          : [...prev.severity, severity],
      }));
    }
  };

  const onGroupBySelect = (
    _event: React.MouseEvent | undefined,
    value: string | number | undefined,
  ) => {
    if (typeof value === "string") {
      setFilters((prev) => ({ ...prev, groupBy: [value] }));
      setIsGroupByExpanded(false);
    }
  };

  const onDelete = (type: string, id: string) => {
    if (type === "Severity") {
      setFilters({ ...filters, severity: filters.severity.filter((s) => s !== id) });
    } else if (type === "Group By") {
      setFilters({ ...filters, groupBy: [] });
    } else {
      setFilters({ severity: [], groupBy: [] });
    }
  };

  const onDeleteGroup = (type: string) => {
    if (type === "Severity") {
      setFilters({ ...filters, severity: [] });
    } else if (type === "Group By") {
      setFilters({ ...filters, groupBy: [] });
    }
  };

  const toggleViolation = (violationId: string) => {
    const newSet = new Set(expandedViolations);
    if (newSet.has(violationId)) {
      newSet.delete(violationId);
    } else {
      newSet.add(violationId);
    }
    setExpandedViolations(newSet);
  };

  const severityMenuItems = (
    <SelectList>
      <SelectOption
        hasCheckbox
        key="severityLow"
        value="Low"
        isSelected={filters.severity.includes("Low")}
      >
        Low
      </SelectOption>
      <SelectOption
        hasCheckbox
        key="severityMedium"
        value="Medium"
        isSelected={filters.severity.includes("Medium")}
      >
        Medium
      </SelectOption>
      <SelectOption
        hasCheckbox
        key="severityHigh"
        value="High"
        isSelected={filters.severity.includes("High")}
      >
        High
      </SelectOption>
    </SelectList>
  );

  const groupByMenuItems = (
    <SelectList>
      <SelectOption
        hasCheckbox
        key="groupByNone"
        value="none"
        isSelected={filters.groupBy.includes("none")}
      >
        No Grouping
      </SelectOption>
      <SelectOption
        hasCheckbox
        key="groupByFile"
        value="file"
        isSelected={filters.groupBy.includes("file")}
      >
        File
      </SelectOption>
      <SelectOption
        hasCheckbox
        key="groupByViolation"
        value="violation"
        isSelected={filters.groupBy.includes("violation")}
      >
        Violation
      </SelectOption>
      <SelectOption
        hasCheckbox
        key="groupBySeverity"
        value="severity"
        isSelected={filters.groupBy.includes("severity")}
      >
        Severity
      </SelectOption>
    </SelectList>
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
        <ToolbarFilter
          labels={filters.groupBy}
          deleteLabel={(category, label) => onDelete(category as string, label as string)}
          deleteLabelGroup={(category) => onDeleteGroup(category as string)}
          categoryName="Group By"
        >
          <Select
            aria-label="Group By"
            role="menu"
            toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
              <MenuToggle
                ref={toggleRef}
                onClick={() => setIsGroupByExpanded(!isGroupByExpanded)}
                isExpanded={isGroupByExpanded}
                style={{ width: "140px" }}
              >
                Group By
                {filters.groupBy.length > 0 && <Badge isRead>{filters.groupBy.length}</Badge>}
              </MenuToggle>
            )}
            onSelect={onGroupBySelect}
            selected={filters.groupBy}
            isOpen={isGroupByExpanded}
            onOpenChange={(isOpen) => setIsGroupByExpanded(isOpen)}
          >
            {groupByMenuItems}
          </Select>
        </ToolbarFilter>
        <ToolbarFilter
          labels={filters.severity}
          deleteLabel={(category, label) => onDelete(category as string, label as string)}
          deleteLabelGroup={(category) => onDeleteGroup(category as string)}
          categoryName="Severity"
        >
          <Select
            aria-label="Severity"
            role="menu"
            toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
              <MenuToggle
                ref={toggleRef}
                onClick={() => setIsSeverityExpanded(!isSeverityExpanded)}
                isExpanded={isSeverityExpanded}
                style={{ width: "140px" }}
              >
                Severity
                {filters.severity.length > 0 && <Badge isRead>{filters.severity.length}</Badge>}
              </MenuToggle>
            )}
            onSelect={onSeveritySelect}
            selected={filters.severity}
            isOpen={isSeverityExpanded}
            onOpenChange={(isOpen) => setIsSeverityExpanded(isOpen)}
          >
            {severityMenuItems}
          </Select>
        </ToolbarFilter>
      </ToolbarGroup>
    </React.Fragment>
  );

  const toolbarItems = (
    <React.Fragment>
      <ToolbarToggleGroup toggleIcon={<FilterIcon />} breakpoint="xl">
        {toggleGroupItems}
      </ToolbarToggleGroup>
    </React.Fragment>
  );

  // Filter and group the incidents based on current filters
  const groupedIncidents = React.useMemo(() => {
    let filtered = violations.flatMap((violation) =>
      violation.incidents.map((incident) => ({
        ...incident,
        violationId: violation.id,
        violationDescription: violation.description,
      })),
    );

    if (searchTerm) {
      const lowercaseSearchTerm = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (incident) =>
          incident.message.toLowerCase().includes(lowercaseSearchTerm) ||
          incident.uri.toLowerCase().includes(lowercaseSearchTerm),
      );
    }

    if (filters.severity.length > 0) {
      filtered = filtered.filter((incident) =>
        filters.severity.includes(incident.severity || "Low"),
      );
    }

    const groups = new Map<string, { label: string; incidents: typeof filtered }>();

    const groupBy = filters.groupBy[0] || "none";
    filtered.forEach((incident) => {
      let key: string;
      let label: string;

      switch (groupBy) {
        case "file":
          key = incident.uri;
          label = path.basename(incident.uri);
          break;
        case "violation":
          key = incident.violationId;
          label = incident.violationDescription;
          break;
        case "severity":
          key = incident.severity || "Low";
          label = `Severity: ${incident.severity || "Low"}`;
          break;
        default:
          key = "all";
          label = "All Incidents";
      }

      if (!groups.has(key)) {
        groups.set(key, { label, incidents: [] });
      }
      groups.get(key)!.incidents.push(incident);
    });

    return Array.from(groups.entries()).map(([id, { label, incidents }]) => ({
      id,
      label,
      incidents,
    }));
  }, [violations, searchTerm, filters]);

  return (
    <Stack hasGutter>
      <StackItem>
        <Toolbar
          id="violation-incidents-toolbar"
          className="pf-m-toggle-group-container"
          collapseListedFiltersBreakpoint="xl"
          clearAllFilters={() => onDelete("", "")}
        >
          <ToolbarContent>{toolbarItems}</ToolbarContent>
        </Toolbar>
      </StackItem>
      <StackItem isFilled>
        {groupedIncidents.map((group) => (
          <Card
            key={group.id}
            isExpanded={expandedViolations.has(group.id)}
            isCompact
            style={{ marginBottom: "10px" }}
          >
            <CardHeader onExpand={() => toggleViolation(group.id)}>
              <Content>
                <h3>{group.label}</h3>
                <Flex>
                  <Label color="blue" isCompact>
                    {group.incidents.length} incidents
                  </Label>
                </Flex>
              </Content>
            </CardHeader>
            <CardExpandableContent>
              <CardBody>
                <IncidentTableGroup
                  onGetSolution={onGetSolution}
                  onIncidentSelect={onIncidentSelect}
                  incidents={group.incidents}
                  workspaceRoot={workspaceRoot}
                />
              </CardBody>
            </CardExpandableContent>
          </Card>
        ))}
      </StackItem>
    </Stack>
  );
};

export default ViolationIncidentsList;
