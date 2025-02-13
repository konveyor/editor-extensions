import React from "react";
import {
  Button,
  Toolbar,
  ToolbarItem,
  ToolbarContent,
  ToolbarGroup,
  MenuToggle,
  MenuToggleElement,
  SearchInput,
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
  ToggleGroup,
  ToggleGroupItem,
  Checkbox,
  Dropdown,
  DropdownList,
  DropdownItem,
  Divider,
} from "@patternfly/react-core";
import {
  WrenchIcon,
  ListIcon,
  FileIcon,
  LayerGroupIcon,
  EllipsisVIcon,
} from "@patternfly/react-icons";
import * as path from "path-browserify";
import { EnhancedIncident, Incident, Severity } from "@editor-extensions/shared";
import { IncidentTableGroup } from "./IncidentTable/IncidentTableGroup";

type GroupByOption = "none" | "file" | "violation";

interface ViolationIncidentsListProps {
  onIncidentSelect: (incident: Incident) => void;
  expandedViolations: Set<string>;
  setExpandedViolations: (value: Set<string>) => void;
  onGetSolution: (enhancedIncidents: EnhancedIncident[]) => void;
  workspaceRoot: string;
  isRunning: boolean;
  focusedIncident: Incident | null;
  enhancedIncidents: EnhancedIncident[];
}

const ViolationIncidentsList = ({
  onIncidentSelect,
  expandedViolations,
  setExpandedViolations,
  onGetSolution,
  workspaceRoot,
  enhancedIncidents,
}: ViolationIncidentsListProps) => {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [selectedGroups, setSelectedGroups] = React.useState<Set<string>>(new Set());
  const [selectedIncidents, setSelectedIncidents] = React.useState<Set<string>>(new Set());
  const [dropdownOpen, setDropdownOpen] = React.useState<{ [key: string]: boolean }>({});
  const [filters, setFilters] = React.useState({
    groupBy: "violation" as GroupByOption,
  });

  const handleGroupBySelect = (groupBy: GroupByOption) => {
    setFilters((prev) => ({ ...prev, groupBy }));
  };

  const onDelete = (type: string, id: string) => {
    setFilters({ groupBy: "violation" });
  };

  const onDeleteGroup = (type: string) => {};

  const toggleViolation = (violationId: string) => {
    const newSet = new Set(expandedViolations);
    if (newSet.has(violationId)) {
      newSet.delete(violationId);
    } else {
      newSet.add(violationId);
    }
    setExpandedViolations(newSet);
  };

  const toggleGroupSelection = (groupId: string) => {
    const newSelected = new Set(selectedGroups);
    if (newSelected.has(groupId)) {
      newSelected.delete(groupId);
      // Deselect all incidents in this group
      const groupIncidents = groupedIncidents.find((g) => g.id === groupId)?.incidents || [];
      const newSelectedIncidents = new Set(selectedIncidents);
      groupIncidents.forEach((incident) => {
        const incidentId = `${incident.uri}-${incident.lineNumber}`;
        newSelectedIncidents.delete(incidentId);
      });
      setSelectedIncidents(newSelectedIncidents);
    } else {
      newSelected.add(groupId);
      // Select all incidents in this group
      const groupIncidents = groupedIncidents.find((g) => g.id === groupId)?.incidents || [];
      const newSelectedIncidents = new Set(selectedIncidents);
      groupIncidents.forEach((incident) => {
        const incidentId = `${incident.uri}-${incident.lineNumber}`;
        newSelectedIncidents.add(incidentId);
      });
      setSelectedIncidents(newSelectedIncidents);
    }
    setSelectedGroups(newSelected);
  };

  const handleIncidentSelectionChange = (incidentId: string, isSelected: boolean) => {
    const newSelected = new Set(selectedIncidents);
    if (isSelected) {
      newSelected.add(incidentId);
    } else {
      newSelected.delete(incidentId);
    }
    setSelectedIncidents(newSelected);

    // Update group selection state
    const updatedGroups = new Set(selectedGroups);
    groupedIncidents.forEach((group) => {
      const groupIncidentIds = group.incidents.map(
        (incident) => `${incident.uri}-${incident.lineNumber}`,
      );
      const allSelected = groupIncidentIds.every((id) => newSelected.has(id));
      if (allSelected) {
        updatedGroups.add(group.id);
      } else {
        updatedGroups.delete(group.id);
      }
    });
    setSelectedGroups(updatedGroups);
  };

  const handleGetSolution = (incidents: EnhancedIncident[]) => {
    if (incidents.length > 0) {
      onGetSolution(incidents);
    }
  };

  // Filter and group the incidents based on current filters
  const groupedIncidents = React.useMemo(() => {
    let filtered = enhancedIncidents;

    if (searchTerm) {
      const lowercaseSearchTerm = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (incident) =>
          incident.message.toLowerCase().includes(lowercaseSearchTerm) ||
          incident.uri.toLowerCase().includes(lowercaseSearchTerm),
      );
    }

    const groups = new Map<string, { label: string; incidents: EnhancedIncident[] }>();

    filtered.forEach((incident) => {
      let key: string;
      let label: string;

      switch (filters.groupBy) {
        case "file":
          key = incident.uri;
          label = path.basename(incident.uri);
          break;
        case "violation":
          key = incident.violationId;
          label = incident?.violation_description || "Unknown Violation";
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
  }, [enhancedIncidents, searchTerm, filters]);

  const totalIncidents = groupedIncidents.reduce((sum, group) => sum + group.incidents.length, 0);
  const allIncidents = groupedIncidents.flatMap((group) => group.incidents);
  const allIncidentIds = new Set(
    allIncidents.map((incident) => `${incident.uri}-${incident.lineNumber}`),
  );
  const isAllSelected =
    allIncidentIds.size > 0 && Array.from(allIncidentIds).every((id) => selectedIncidents.has(id));
  const isIndeterminate =
    selectedIncidents.size > 0 && selectedIncidents.size < allIncidentIds.size;

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIncidents(allIncidentIds);
      setSelectedGroups(new Set(groupedIncidents.map((group) => group.id)));
    } else {
      setSelectedIncidents(new Set());
      setSelectedGroups(new Set());
    }
  };

  const toolbarItems = (
    <React.Fragment>
      <ToolbarGroup></ToolbarGroup>
      <ToolbarGroup>
        <ToolbarItem>
          <SearchInput
            aria-label="Search violations and incidents"
            onChange={(_event, value) => setSearchTerm(value)}
            value={searchTerm}
            onClear={() => setSearchTerm("")}
          />
        </ToolbarItem>
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarItem>
          <ToggleGroup aria-label="Group by options">
            <ToggleGroupItem
              icon={<ListIcon />}
              text="All"
              buttonId="none"
              isSelected={filters.groupBy === "none"}
              onChange={() => handleGroupBySelect("none")}
            />
            <ToggleGroupItem
              icon={<FileIcon />}
              text="Files"
              buttonId="file"
              isSelected={filters.groupBy === "file"}
              onChange={() => handleGroupBySelect("file")}
            />
            <ToggleGroupItem
              icon={<LayerGroupIcon />}
              text="Issues"
              buttonId="violation"
              isSelected={filters.groupBy === "violation"}
              onChange={() => handleGroupBySelect("violation")}
            />
          </ToggleGroup>
        </ToolbarItem>
        <ToolbarItem>
          <Checkbox
            id="select-all-incidents"
            aria-label="Select all incidents"
            isChecked={isAllSelected}
            onChange={(_event, checked) => handleSelectAll(checked)}
            label={`Select all (${totalIncidents})`}
          />
        </ToolbarItem>
      </ToolbarGroup>
      {selectedIncidents.size > 0 && (
        <ToolbarGroup variant="action-group-inline">
          <ToolbarItem>
            <Button
              variant="primary"
              onClick={() => {
                const selectedIncidentsList = enhancedIncidents.filter((incident) =>
                  selectedIncidents.has(`${incident.uri}-${incident.lineNumber}`),
                );
                handleGetSolution(selectedIncidentsList);
              }}
            >
              Resolve {selectedIncidents.size} selected incidents
            </Button>
          </ToolbarItem>
        </ToolbarGroup>
      )}
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
            isSelectable
            style={{ marginBottom: "10px" }}
          >
            <CardHeader
              onExpand={() => toggleViolation(group.id)}
              actions={{
                actions: [
                  <Checkbox
                    key="select-group"
                    aria-label={`Select ${group.label}`}
                    id={`select-${group.id}`}
                    isChecked={selectedGroups.has(group.id)}
                    onChange={() => toggleGroupSelection(group.id)}
                  />,
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
                  workspaceRoot={workspaceRoot}
                  selectedIncidents={selectedIncidents}
                  onIncidentSelectionChange={handleIncidentSelectionChange}
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
