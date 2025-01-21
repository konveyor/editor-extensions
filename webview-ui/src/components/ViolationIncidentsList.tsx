import "./violations.css";
import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  Flex,
  FlexItem,
  Content,
  Card,
  CardBody,
  Button,
  Stack,
  StackItem,
  TextInput,
  Select,
  SelectOption,
  MenuToggle,
  Label,
  MenuToggleElement,
  InputGroup,
  CardHeader,
  CardExpandableContent,
} from "@patternfly/react-core";
import { SortAmountDownIcon, TimesIcon } from "@patternfly/react-icons";
import { Incident, Violation, Severity } from "@editor-extensions/shared";
import { IncidentTableGroup } from "./IncidentTable";
import ViolationActionsDropdown from "./ViolationActionsDropdown";

type SortOption = "description" | "incidentCount" | "severity";

interface ViolationIncidentsListProps {
  isRunning: boolean;
  violations: Violation[];
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
  compact = false,
  expandedViolations,
  setExpandedViolations,
  onGetSolution,
  workspaceRoot,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const initialSortBy = localStorage?.getItem(SORT_STORAGE_KEY) || "description";
  const [sortBy, setSortBy] = useState<SortOption>(initialSortBy as SortOption);

  const [isSortSelectOpen, setIsSortSelectOpen] = useState(false);

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

    if (searchTerm) {
      const lowercaseSearchTerm = searchTerm.toLowerCase();

      result = result
        .map((violation) => {
          // Filter incidents within the violation based on the search term
          const filteredIncidents = violation.incidents.filter(
            (incident) =>
              incident.message.toLowerCase().includes(lowercaseSearchTerm) ||
              incident.uri.toLowerCase().includes(lowercaseSearchTerm),
          );

          return {
            ...violation,
            incidents: filteredIncidents,
          };
        })
        // Only keep violations that have at least one matching incident or match in the description
        .filter(
          (violation) =>
            violation.incidents.length > 0 ||
            violation.description.toLowerCase().includes(lowercaseSearchTerm),
        );
    }

    // Sort the violations according to the selected criteria
    result.sort((a, b) => {
      switch (sortBy) {
        case "description":
          return a.description.localeCompare(b.description);
        case "incidentCount":
          return b.incidents.length - a.incidents.length;
        case "severity": {
          const severityOrder = { high: 3, medium: 2, low: 1 };
          const aMaxSeverity =
            severityOrder[getHighestSeverity(a.incidents) as keyof typeof severityOrder];
          const bMaxSeverity =
            severityOrder[getHighestSeverity(b.incidents) as keyof typeof severityOrder];
          return bMaxSeverity - aMaxSeverity;
        }
        default:
          return 0;
      }
    });

    return result;
  }, [violations, searchTerm, sortBy]);

  const renderViolation = useCallback(
    (violation: Violation) => {
      const truncateText = (text: string, maxLength: number) => {
        if (text.length <= maxLength) {
          return text;
        }
        return text.slice(0, maxLength) + "...";
      };
      const isExpanded = expandedViolations.has(violation.description);
      const highestSeverity = getHighestSeverity(violation.incidents);
      const truncatedDescription = truncateText(violation.description, 100);

      return (
        <Card
          isExpanded={isExpanded}
          isCompact
          key={violation.description}
          style={{ marginBottom: "10px" }}
        >
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
            onExpand={() => toggleViolation(violation.description)}
          >
            <Content style={{ marginBottom: "5px" }}>{truncatedDescription}</Content>
            <Flex>
              <Label color="blue" isCompact>
                {violation.incidents.length} incidents
              </Label>
              <Label
                color={
                  highestSeverity === "high"
                    ? "red"
                    : highestSeverity === "medium"
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
    [expandedViolations, toggleViolation],
  );

  const onSortToggle = () => {
    setIsSortSelectOpen(!isSortSelectOpen);
  };

  const sortToggle = (toggleRef: React.Ref<MenuToggleElement>) => (
    <MenuToggle
      ref={toggleRef}
      onClick={onSortToggle}
      isExpanded={isSortSelectOpen}
      style={{ width: "200px" }}
    >
      <SortAmountDownIcon /> {sortBy}
    </MenuToggle>
  );

  const clearSearch = () => {
    setSearchTerm("");
  };

  return (
    <Stack hasGutter>
      <StackItem>
        <Flex>
          <FlexItem grow={{ default: "grow" }}>
            <InputGroup>
              <TextInput
                type="text"
                id="violation-search"
                aria-label="Search violations and incidents"
                placeholder="Search violations and incidents..."
                value={searchTerm}
                onChange={(_event, value) => setSearchTerm(value)}
              />
              {searchTerm && (
                <Button variant="control" onClick={clearSearch} aria-label="Clear search">
                  <TimesIcon />
                </Button>
              )}
            </InputGroup>
          </FlexItem>
          <FlexItem>
            <Select
              toggle={sortToggle}
              onSelect={(_event, value) => {
                setSortBy(value as SortOption);
                setIsSortSelectOpen(false);
              }}
              selected={sortBy}
              isOpen={isSortSelectOpen}
              aria-label="Select sort option"
            >
              <SelectOption value="description">Description</SelectOption>
              <SelectOption value="incidentCount">Incident Count</SelectOption>
              <SelectOption value="severity">Severity</SelectOption>
            </Select>
          </FlexItem>
        </Flex>
      </StackItem>
      <StackItem isFilled>
        <div
          style={{
            height: compact ? "200px" : "calc(100vh - 200px)",
            overflowY: "auto",
          }}
        >
          {filteredAndSortedViolations.map((violation) => renderViolation(violation))}
        </div>
      </StackItem>
    </Stack>
  );
};

export default ViolationIncidentsList;
