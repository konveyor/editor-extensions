import React, { useState, useCallback, useMemo } from "react";
import { Violation, Incident } from "../types";
import {
  ExpandableSection,
  Badge,
  Flex,
  FlexItem,
  Text,
  TextVariants,
  Card,
  CardBody,
  Button,
  Stack,
  StackItem,
  Tooltip,
  TextInput,
  Divider,
} from "@patternfly/react-core";
import { ArrowLeftIcon } from "@patternfly/react-icons";
import { vscode } from "../globals";

interface ViolationIncidentsListProps {
  violations: Violation[];
  focusedIncident?: Incident;
}

const ViolationIncidentsList: React.FC<ViolationIncidentsListProps> = ({
  violations,
  focusedIncident,
}) => {
  const [expandedViolations, setExpandedViolations] = useState<Set<string>>(new Set());
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

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

  const handleIncidentClick = useCallback((incident: Incident) => {
    setSelectedIncident(incident);
    vscode.postMessage({
      command: "openFile",
      file: incident.uri,
      line: incident.uri,
    });
  }, []);

  const filteredViolations = useMemo(() => {
    if (!searchTerm) {
      return violations;
    }

    const lowercaseSearchTerm = searchTerm.toLowerCase();
    return violations.filter((violation) => {
      const matchingIncidents = violation.incidents.filter(
        (incident) =>
          incident.message.toLowerCase().includes(lowercaseSearchTerm) ||
          incident.uri.toLowerCase().includes(lowercaseSearchTerm),
      );

      return (
        matchingIncidents.length > 0 ||
        violation.description.toLowerCase().includes(lowercaseSearchTerm)
      );
    });
  }, [violations, searchTerm]);

  const renderViolation = useCallback(
    (violation: Violation) => {
      const isExpanded = expandedViolations.has(violation.description);

      return (
        <Card isCompact key={violation.description} style={{ marginBottom: "10px" }}>
          <CardBody>
            <ExpandableSection
              toggleContent={
                <Tooltip content={violation.description}>
                  <Text className="truncate-text" style={{ maxWidth: "100%" }}>
                    {violation.description}
                  </Text>
                </Tooltip>
              }
              onToggle={() => toggleViolation(violation.description)}
              isExpanded={isExpanded}
            >
              <Stack hasGutter>
                <StackItem>
                  <Text component={TextVariants.h4}>Incidents:</Text>
                </StackItem>
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
                            isActive={focusedIncident && focusedIncident.id === incident.id}
                          >
                            {incident.message}
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

  return (
    <Stack hasGutter>
      <StackItem>
        <TextInput
          type="text"
          id="violation-search"
          aria-label="Search violations and incidents"
          placeholder="Search violations and incidents..."
          value={searchTerm}
          onChange={(_event, value) => setSearchTerm(value)}
          // icon={<SearchIcon />}
        />
      </StackItem>
      {selectedIncident && (
        <StackItem>
          <Card>
            <CardBody>
              <Button
                variant="link"
                icon={<ArrowLeftIcon />}
                onClick={() => setSelectedIncident(null)}
              >
                Back to violations
              </Button>
              <Text component={TextVariants.h3}>{selectedIncident.message}</Text>
              <Text component={TextVariants.p}>
                <strong>Severity:</strong> {selectedIncident.severity}
              </Text>
              <Text component={TextVariants.p}>
                <strong>File:</strong> {selectedIncident.uri}
              </Text>
              <Text component={TextVariants.p}>
                <strong>Line:</strong> {selectedIncident.lineNumber}
              </Text>
            </CardBody>
          </Card>
          <Divider style={{ margin: "20px 0" }} />
        </StackItem>
      )}
      <StackItem isFilled>
        <div style={{ height: "calc(100vh - 200px)", overflowY: "auto" }}>
          {filteredViolations.map((violation) => renderViolation(violation))}
        </div>
      </StackItem>
    </Stack>
  );
};

export default ViolationIncidentsList;
