import React, { useState, useCallback } from "react";
import { Violation, Incident } from "../types";
import {
  ExpandableSection,
  Badge,
  Flex,
  FlexItem,
  Text,
  Card,
  CardBody,
  Button,
  Stack,
  StackItem,
  Tooltip,
  TextInput,
  Select,
  SelectOption,
  MenuToggle,
  Label,
  MenuToggleElement,
} from "@patternfly/react-core";
import { SortAmountDownIcon } from "@patternfly/react-icons";
import { vscode } from "../globals";

interface ViolationIncidentsListProps {
  violations: Violation[];
  focusedIncident?: Incident | null;
  onIncidentSelect?: (incident: Incident | null) => void;
  compact?: boolean;
}

type SortOption = "description" | "incidentCount" | "severity";

const ViolationIncidentsList: React.FC<ViolationIncidentsListProps> = ({
  violations,
  focusedIncident,
  onIncidentSelect,
  compact = false,
}) => {
  const [expandedViolations, setExpandedViolations] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("description");
  const [isSortSelectOpen, setIsSortSelectOpen] = useState(false);

  const toggleViolation = useCallback((violationId: string) => {
    setExpandedViolations((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(violationId)) {
        newSet.delete(violationId);
      } else {
        newSet.add(violationId);
      }
      return newSet;
    });
  }, []);

  const handleIncidentClick = useCallback(
    (incident: Incident) => {
      if (onIncidentSelect) {
        onIncidentSelect(incident);
      }
      vscode.postMessage({
        command: "openFile",
        file: incident.uri,
        line: incident.lineNumber,
      });
    },
    [onIncidentSelect],
  );

  const getHighestSeverity = (incidents: Incident[]): string => {
    const severityOrder = { high: 3, medium: 2, low: 1 };
    return incidents.reduce((highest, incident) => {
      const currentSeverity = severityOrder[incident.severity as keyof typeof severityOrder] || 0;
      const highestSeverity = severityOrder[highest as keyof typeof severityOrder] || 0;
      return currentSeverity > highestSeverity ? incident.severity : highest;
    }, "low");
  };

  // const filteredAndSortedViolations = useMemo(() => {
  //   let result = violations;

  //   // Filter
  //   if (searchTerm) {
  //     const lowercaseSearchTerm = searchTerm.toLowerCase();
  //     result = result.filter((violation) => {
  //       const matchingIncidents = violation.incidents.filter(
  //         (incident) =>
  //           incident.message.toLowerCase().includes(lowercaseSearchTerm) ||
  //           incident.uri.toLowerCase().includes(lowercaseSearchTerm),
  //       );

  //       return (
  //         matchingIncidents.length > 0 ||
  //         violation.description.toLowerCase().includes(lowercaseSearchTerm)
  //       );
  //     });
  //   }

  //   // Sort
  //   result.sort((a, b) => {
  //     switch (sortBy) {
  //       case "description":
  //         return a.description.localeCompare(b.description);
  //       case "incidentCount":
  //         return b.incidents.length - a.incidents.length;
  //       case "severity":
  //         const severityOrder = { high: 3, medium: 2, low: 1 };
  //         const aMaxSeverity =
  //           severityOrder[getHighestSeverity(a.incidents) as keyof typeof severityOrder];
  //         const bMaxSeverity =
  //           severityOrder[getHighestSeverity(b.incidents) as keyof typeof severityOrder];
  //         return bMaxSeverity - aMaxSeverity;
  //       default:
  //         return 0;
  //     }
  //   });

  //   return result;
  // }, [violations, searchTerm, sortBy]);

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
      const truncatedDescription = truncateText(violation.description, 80);

      return (
        <Card isCompact key={violation.description} style={{ marginBottom: "10px" }}>
          <CardBody>
            <ExpandableSection
              toggleContent={
                <Flex alignItems={{ default: "alignItemsCenter" }}>
                  <FlexItem grow={{ default: "grow" }}>
                    <Tooltip content={violation.description}>
                      <Text
                        className="truncate-text"
                        style={{
                          maxWidth: "100%",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {truncatedDescription}
                      </Text>
                    </Tooltip>
                  </FlexItem>
                  <FlexItem>
                    <Label color="blue" isCompact>
                      {violation.incidents.length} incidents
                    </Label>
                  </FlexItem>
                  <FlexItem>
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
                  </FlexItem>
                </Flex>
              }
              onToggle={() => toggleViolation(violation.description)}
              isExpanded={isExpanded}
            >
              <Stack hasGutter>
                {violation.incidents.map((incident) => (
                  <StackItem key={incident.id}>
                    <Flex
                      justifyContent={{ default: "justifyContentSpaceBetween" }}
                      alignItems={{ default: "alignItemsCenter" }}
                    >
                      <FlexItem grow={{ default: "grow" }}>
                        <Tooltip content={incident.message}>
                          <Button
                            variant="link"
                            onClick={() => handleIncidentClick(incident)}
                            className="truncate-text"
                            style={{
                              maxWidth: "100%",
                              textAlign: "left",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                            isActive={focusedIncident ? focusedIncident.id === incident?.id : false}
                          >
                            {truncateText(incident.message, 60)}
                          </Button>
                        </Tooltip>
                      </FlexItem>
                      <FlexItem>
                        <Badge>{incident.severity}</Badge>
                      </FlexItem>
                    </Flex>
                  </StackItem>
                ))}
              </Stack>
            </ExpandableSection>
          </CardBody>
        </Card>
      );
    },
    [expandedViolations, handleIncidentClick, toggleViolation, focusedIncident],
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

  return (
    <Stack hasGutter>
      <StackItem>
        <Flex>
          <FlexItem grow={{ default: "grow" }}>
            <TextInput
              type="text"
              id="violation-search"
              aria-label="Search violations and incidents"
              placeholder="Search violations and incidents..."
              value={searchTerm}
              onChange={(_event, value) => setSearchTerm(value)}
            />
          </FlexItem>
          <FlexItem>
            <Select
              toggle={sortToggle}
              onSelect={(event, value) => {
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
        <div style={{ height: compact ? "200px" : "calc(100vh - 200px)", overflowY: "auto" }}>
          {violations.map((violation) => renderViolation(violation))}
        </div>
      </StackItem>
    </Stack>
  );
};

export default ViolationIncidentsList;
