import React from "react";
import {
  Button,
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
  Split,
  SplitItem,
} from "@patternfly/react-core";
import { FilterIcon, WrenchIcon } from "@patternfly/react-icons";
import { IncidentTableGroup } from "./IncidentTable";
import * as path from "path-browserify";
import {
  EnhancedIncident,
  Incident,
  Severity,
  Violation,
  EnhancedViolation,
} from "@editor-extensions/shared";
import { enhanceIncidents } from "../utils/transformation";

interface ViolationIncidentsListProps {
  violations: EnhancedViolation[];
  onIncidentSelect: (incident: Incident) => void;
  expandedViolations: Set<string>;
  setExpandedViolations: (value: Set<string>) => void;
  onGetSolution: (enhancedIncidents: EnhancedIncident[]) => void;
  workspaceRoot: string;
  isRunning: boolean;
  focusedIncident: Incident | null;
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

  const handleGetSolution = (incidents: EnhancedIncident[]) => {
    if (incidents.length > 0) {
      const violation = violations.find((v) => v.id === incidents[0].violationId);

      if (violation) {
        const enhancedIncidentsFromViolation = enhanceIncidents(incidents, violation);
        onGetSolution(enhancedIncidentsFromViolation);
      }
    }
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

  // Filter and group the incidents based on current filters
  const groupedIncidents = React.useMemo(() => {
    let filtered = violations.flatMap(
      (violation) =>
        violation.incidents.map((incident) => ({
          ...incident,
          violationId: violation.id,
          violationDescription: violation.description,
        })) as EnhancedIncident[],
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

    const groups = new Map<string, { label: string; incidents: EnhancedIncident[] }>();

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

  const toolbarItems = (
    <React.Fragment>
      <ToolbarToggleGroup toggleIcon={<FilterIcon />} breakpoint="xl">
        {toggleGroupItems}
      </ToolbarToggleGroup>
      <ToolbarGroup variant="action-group-inline">
        <ToolbarItem>
          {groupedIncidents.length > 0 && (
            <Button
              variant="plain"
              aria-label="Resolve all visible incidents"
              icon={<WrenchIcon />}
              onClick={() => {
                const allIncidents = groupedIncidents.flatMap((group) => group.incidents);
                handleGetSolution(allIncidents);
              }}
            >
              Resolve {groupedIncidents.reduce((sum, group) => sum + group.incidents.length, 0)}{" "}
              incidents
            </Button>
          )}
        </ToolbarItem>
      </ToolbarGroup>
    </React.Fragment>
  );

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
            <CardHeader
              onExpand={() => toggleViolation(group.id)}
              actions={{
                actions: [
                  <Button
                    key="get-solution"
                    variant="plain"
                    aria-label={`Resolve ${group.incidents.length} incidents`}
                    icon={<WrenchIcon />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleGetSolution(group.incidents);
                    }}
                  >
                    Resolve {group.incidents.length} incidents
                  </Button>,
                ],
                hasNoOffset: true,
              }}
            >
              <Split>
                <SplitItem isFilled>
                  <Content>
                    <h3>{group.label}</h3>
                    <Flex>
                      <Label color="blue" isCompact>
                        {group.incidents.length} incidents
                      </Label>
                    </Flex>
                  </Content>
                </SplitItem>
              </Split>
            </CardHeader>
            <CardExpandableContent>
              <CardBody>
                <IncidentTableGroup
                  onGetSolution={onGetSolution}
                  onIncidentSelect={onIncidentSelect}
                  incidents={group.incidents}
                  violation={violations.find((v) => v.id === group.incidents[0].violationId)}
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
