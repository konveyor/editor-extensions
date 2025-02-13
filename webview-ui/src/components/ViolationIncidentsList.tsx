import React from "react";
import {
  Toolbar,
  ToolbarItem,
  ToolbarContent,
  ToolbarGroup,
  ToolbarToggleGroup,
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
  ToggleGroup,
  ToggleGroupItem,
} from "@patternfly/react-core";
import {
  ListIcon,
  FileIcon,
  LayerGroupIcon,
  SortAmountDownIcon,
  SortAmountUpIcon,
  FilterIcon,
} from "@patternfly/react-icons";
import { IncidentTableGroup } from "./IncidentTable";
import * as path from "path-browserify";
import { EnhancedIncident, Incident, Category } from "@editor-extensions/shared";
import GetSolutionDropdown from "./GetSolutionDropdown";

type GroupByOption = "none" | "file" | "violation";

interface ViolationIncidentsListProps {
  onIncidentSelect: (incident: Incident) => void;
  expandedViolations: Set<string>;
  setExpandedViolations: (value: Set<string>) => void;
  focusedIncident: Incident | null;
  enhancedIncidents: EnhancedIncident[];
}

const ViolationIncidentsList = ({
  onIncidentSelect,
  expandedViolations,
  setExpandedViolations,
  enhancedIncidents,
}: ViolationIncidentsListProps) => {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [isSortAscending, setIsSortAscending] = React.useState(true);
  const [isCategoryExpanded, setIsCategoryExpanded] = React.useState(false);
  const [filters, setFilters] = React.useState({
    category: [] as Category[],
    groupBy: "violation" as GroupByOption,
  });

  const onCategorySelect = (
    _event: React.MouseEvent | undefined,
    value: string | number | undefined,
  ) => {
    if (typeof value === "string") {
      const category = value as Category;
      setFilters((prev) => ({
        ...prev,
        category: prev.category.includes(category)
          ? prev.category.filter((s) => s !== category)
          : [...prev.category, category],
      }));
    }
  };

  const handleGroupBySelect = (groupBy: GroupByOption) => {
    setFilters((prev) => ({ ...prev, groupBy }));
  };

  const onDelete = (type: string, id: string) => {
    if (type === "Category") {
      setFilters({ ...filters, category: filters.category.filter((s) => s !== id) });
    } else {
      setFilters({ category: [], groupBy: "violation" });
    }
  };

  const onDeleteGroup = (type: string) => {
    if (type === "Category") {
      setFilters({ ...filters, category: [] });
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

  const categoryMenuItems = (
    <SelectList>
      <SelectOption
        hasCheckbox
        key="categoryPotential"
        value="potential"
        isSelected={filters.category.includes("potential")}
      >
        Potential
      </SelectOption>
      <SelectOption
        hasCheckbox
        key="categoryOptional"
        value="optional"
        isSelected={filters.category.includes("optional")}
      >
        Optional
      </SelectOption>
      <SelectOption
        hasCheckbox
        key="categoryMandatory"
        value="mandatory"
        isSelected={filters.category.includes("mandatory")}
      >
        Mandatory
      </SelectOption>
    </SelectList>
  );

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

    if (filters.category.length > 0) {
      filtered = filtered.filter((incident) =>
        filters.category.includes(incident.violation_category || "potential"),
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

    const sortedGroups = Array.from(groups.entries()).map(([id, { label, incidents }]) => ({
      id,
      label,
      incidents,
    }));

    sortedGroups.sort((a, b) => {
      const fieldA = a.label.toLowerCase();
      const fieldB = b.label.toLowerCase();
      return isSortAscending ? fieldA.localeCompare(fieldB) : fieldB.localeCompare(fieldA);
    });

    return sortedGroups;
  }, [enhancedIncidents, searchTerm, filters, isSortAscending]);

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
      </ToolbarGroup>
      <ToolbarItem>
        <Select
          aria-label="Category"
          toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
            <MenuToggle
              ref={toggleRef}
              onClick={() => setIsCategoryExpanded(!isCategoryExpanded)}
              isExpanded={isCategoryExpanded}
              style={{ width: "140px" }}
            >
              Category
              {filters.category.length > 0 && <Badge isRead>{filters.category.length}</Badge>}
            </MenuToggle>
          )}
          onSelect={onCategorySelect}
          selected={filters.category}
          isOpen={isCategoryExpanded}
          onOpenChange={(isOpen) => setIsCategoryExpanded(isOpen)}
        >
          {categoryMenuItems}
        </Select>
      </ToolbarItem>
      <ToolbarItem>
        <ToggleGroup aria-label="Sort toggle group">
          <ToggleGroupItem
            icon={<SortAmountUpIcon />}
            buttonId="sort-ascending"
            isSelected={isSortAscending}
            onChange={() => setIsSortAscending(true)}
          />
          <ToggleGroupItem
            icon={<SortAmountDownIcon />}
            buttonId="sort-descending"
            isSelected={!isSortAscending}
            onChange={() => setIsSortAscending(false)}
          />
        </ToggleGroup>
      </ToolbarItem>
    </React.Fragment>
  );

  return (
    <Stack hasGutter style={{ height: "100%", minHeight: "100vh" }}>
      <StackItem>
        <Toolbar
          id="violation-incidents-toolbar"
          className="pf-m-toggle-group-container"
          collapseListedFiltersBreakpoint="md"
          clearAllFilters={() => onDelete("", "")}
        >
          <ToolbarContent>
            <ToolbarToggleGroup toggleIcon={<FilterIcon />} breakpoint="md">
              {toggleGroupItems}
            </ToolbarToggleGroup>
            <ToolbarItem variant="separator" />
            <ToolbarItem align={{ default: "alignEnd" }}>
              <GetSolutionDropdown
                incidents={groupedIncidents.flatMap((group) => group.incidents)}
                scope="workspace"
              />
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </StackItem>
      <StackItem isFilled style={{ minHeight: 0, overflow: "auto" }}>
        <Stack hasGutter>
          {groupedIncidents.map((group) => (
            <StackItem key={group.id}>
              <Card isExpanded={expandedViolations.has(group.id)} isCompact>
                <CardHeader
                  onExpand={() => toggleViolation(group.id)}
                  actions={{
                    actions: [
                      <GetSolutionDropdown
                        key="get-solution"
                        incidents={group.incidents}
                        scope="issue"
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
                      onIncidentSelect={onIncidentSelect}
                      incidents={group.incidents}
                    />
                  </CardBody>
                </CardExpandableContent>
              </Card>
            </StackItem>
          ))}
        </Stack>
      </StackItem>
    </Stack>
  );
};

export default ViolationIncidentsList;
