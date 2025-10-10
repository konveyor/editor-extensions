import React from "react";
import {
  Toolbar,
  ToolbarItem,
  ToolbarContent,
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
import "./ViolationIncidentsList.css";
import {
  ListIcon,
  FileIcon,
  LayerGroupIcon,
  SortAmountDownIcon,
  SortAmountUpIcon,
  ChartLineIcon,
} from "@patternfly/react-icons";
import { IncidentTableGroup } from "./IncidentTable";
import { EnhancedIncident, Incident, Category } from "@editor-extensions/shared";
import GetSolutionDropdown from "./GetSolutionDropdown";
import { getIncidentFile } from "../utils/incident";

type GroupByOption = "none" | "file" | "violation";

interface ViolationIncidentsListProps {
  onIncidentSelect: (incident: Incident) => void;
  expandedViolations: Set<string>;
  setExpandedViolations: (value: Set<string>) => void;
  focusedIncident: Incident | null;
  enhancedIncidents: EnhancedIncident[];
  solutionServerEnabled: boolean;
}

const ViolationIncidentsList = ({
  onIncidentSelect,
  expandedViolations,
  setExpandedViolations,
  enhancedIncidents,
  solutionServerEnabled,
}: ViolationIncidentsListProps) => {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [isSortAscending, setIsSortAscending] = React.useState(true);
  const [isCategoryExpanded, setIsCategoryExpanded] = React.useState(false);
  const [isSuccessRateExpanded, setIsSuccessRateExpanded] = React.useState(false);
  const [isGroupByExpanded, setIsGroupByExpanded] = React.useState(false);
  const [filters, setFilters] = React.useState({
    category: [] as Category[],
    groupBy: "violation" as GroupByOption,
    hasSuccessRate: false,
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

  // Centralized utility to extract success rate data from metric (handles both array and object formats)
  const extractSuccessRateData = (successRateMetric: any) => {
    if (!successRateMetric) {
      return null;
    }
    // Server can return array format or object format, extract appropriately
    return Array.isArray(successRateMetric) ? successRateMetric[0] : successRateMetric;
  };

  // Helper function to get success rate from any incident in the group
  const getSuccessRate = (incidents: EnhancedIncident[]) => {
    // Find the first incident with success rate data
    const metric = incidents.find((incident) => incident.successRateMetric)?.successRateMetric;
    return extractSuccessRateData(metric);
  };

  // Component for rendering success rate labels
  const SuccessRateLabels = ({
    incidents,
    groupId,
  }: {
    incidents: EnhancedIncident[];
    groupId: string;
  }) => {
    const successRate = getSuccessRate(incidents);
    console.log("successRate", successRate);

    if (!successRate) {
      return null;
    }

    return (
      <>
        {successRate.accepted_solutions > 0 && (
          <Label id={`${groupId}-accepted-solutions`} color="green" isCompact>
            {successRate.accepted_solutions} accepted
          </Label>
        )}
        {successRate.rejected_solutions > 0 && (
          <Label id={`${groupId}-rejected-solutions`} color="red" isCompact>
            {successRate.rejected_solutions} rejected
          </Label>
        )}
      </>
    );
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _onDeleteGroup = (type: string) => {
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
          incident.uri.toLowerCase().includes(lowercaseSearchTerm) ||
          incident.violation_description?.toLowerCase().includes(lowercaseSearchTerm),
      );
    }

    if (filters.category.length > 0) {
      filtered = filtered.filter((incident) =>
        filters.category.includes(incident.violation_category || "potential"),
      );
    }

    if (filters.hasSuccessRate) {
      filtered = filtered.filter((incident) => {
        const successRate = extractSuccessRateData(incident.successRateMetric);
        console.log("Filtering incident:", incident.violationId, "successRate:", successRate);
        return (
          successRate && (successRate.accepted_solutions > 0 || successRate.rejected_solutions > 0)
        );
      });
    }

    const groups = new Map<string, { label: string; incidents: EnhancedIncident[] }>();

    filtered.forEach((incident) => {
      let key: string;
      let label: string;

      switch (filters.groupBy) {
        case "file":
          key = incident.uri;
          label = getIncidentFile(incident);
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

  const toolbarItems = (
    <React.Fragment>
      <ToolbarItem>
        <SearchInput
          aria-label="Search violations and incidents"
          onChange={(_event, value) => setSearchTerm(value)}
          value={searchTerm}
          onClear={() => setSearchTerm("")}
        />
      </ToolbarItem>
      <ToolbarItem>
        <Select
          aria-label="Group by"
          toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
            <MenuToggle
              id="group-by-filter-dropdown"
              ref={toggleRef}
              onClick={() => setIsGroupByExpanded(!isGroupByExpanded)}
              isExpanded={isGroupByExpanded}
              style={{ minWidth: "120px" }}
              icon={
                filters.groupBy === "none" ? (
                  <ListIcon />
                ) : filters.groupBy === "file" ? (
                  <FileIcon />
                ) : (
                  <LayerGroupIcon />
                )
              }
            >
              Group by:{" "}
              {filters.groupBy === "none"
                ? "None"
                : filters.groupBy === "file"
                  ? "Files"
                  : "Issues"}
            </MenuToggle>
          )}
          onSelect={(_event, value) => {
            handleGroupBySelect(value as GroupByOption);
            setIsGroupByExpanded(false);
          }}
          selected={filters.groupBy}
          isOpen={isGroupByExpanded}
          onOpenChange={(isOpen) => setIsGroupByExpanded(isOpen)}
        >
          <SelectList>
            <SelectOption
              id="group-by-all-filter"
              key="none"
              value="none"
              icon={<ListIcon />}
              description="Show all items in a single list"
            >
              All
            </SelectOption>
            <SelectOption
              id="group-by-file-filter"
              key="file"
              value="file"
              icon={<FileIcon />}
              description="Group items by source file"
            >
              Files
            </SelectOption>
            <SelectOption
              id="group-by-violation-filter"
              key="violation"
              value="violation"
              icon={<LayerGroupIcon />}
              description="Group items by issue type"
            >
              Issues
            </SelectOption>
          </SelectList>
        </Select>
      </ToolbarItem>
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
              {filters.category.length > 0 && <Badge>{filters.category.length}</Badge>}
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
      {solutionServerEnabled && (
        <ToolbarItem>
          <Select
            aria-label="Success Rate Filter"
            toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
              <MenuToggle
                ref={toggleRef}
                onClick={() => setIsSuccessRateExpanded(!isSuccessRateExpanded)}
                isExpanded={isSuccessRateExpanded}
                style={{ minWidth: "140px" }}
                icon={<ChartLineIcon />}
                badge={filters.hasSuccessRate ? <Badge>Filtered</Badge> : undefined}
              >
                {filters.hasSuccessRate ? "With Metrics" : "All Results"}
              </MenuToggle>
            )}
            onSelect={(_event, value) => {
              if (value === "with-metrics") {
                setFilters((prev) => ({ ...prev, hasSuccessRate: true }));
              } else {
                setFilters((prev) => ({ ...prev, hasSuccessRate: false }));
              }
              setIsSuccessRateExpanded(false);
            }}
            selected={filters.hasSuccessRate ? "with-metrics" : "all"}
            isOpen={isSuccessRateExpanded}
            onOpenChange={(isOpen) => setIsSuccessRateExpanded(isOpen)}
          >
            <SelectList>
              <SelectOption
                key="all"
                value="all"
                description="Show all items including those without success metrics"
              >
                All Results
              </SelectOption>
              <SelectOption
                key="with-metrics"
                value="with-metrics"
                description="Show only items with success rate data"
              >
                With Metrics Only
              </SelectOption>
            </SelectList>
          </Select>
        </ToolbarItem>
      )}
      <ToolbarItem>
        <ToggleGroup aria-label="Sort toggle group">
          <ToggleGroupItem
            icon={<SortAmountUpIcon />}
            buttonId="sort-ascending"
            isSelected={isSortAscending}
            onChange={() => setIsSortAscending(true)}
            aria-label="Sort ascending"
          />
          <ToggleGroupItem
            icon={<SortAmountDownIcon />}
            buttonId="sort-descending"
            isSelected={!isSortAscending}
            onChange={() => setIsSortAscending(false)}
            aria-label="Sort descending"
          />
        </ToggleGroup>
      </ToolbarItem>
    </React.Fragment>
  );

  return (
    <Stack hasGutter style={{ height: "100%", minHeight: "100vh" }}>
      <StackItem>
        <Toolbar id="violation-incidents-toolbar" className="violation-incidents-toolbar">
          <ToolbarContent>{toolbarItems}</ToolbarContent>
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
                        <Flex spaceItems={{ default: "spaceItemsXs" }}>
                          <Label color="blue" isCompact>
                            {group.incidents.length} incidents
                          </Label>
                          <SuccessRateLabels incidents={group.incidents} groupId={group.id} />
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
