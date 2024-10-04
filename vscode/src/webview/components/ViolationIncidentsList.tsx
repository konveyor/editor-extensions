import React, { useState, useCallback, useMemo } from "react";
import { RuleSet, Violation, Incident } from "../types";
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
  ruleSets: RuleSet[];
}

const ViolationIncidentsList: React.FC<ViolationIncidentsListProps> = ({ ruleSets }) => {
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
      line: incident.lineNumber,
    });
  }, []);

  const filteredViolations = useMemo(() => {
    if (!searchTerm) {
      return ruleSets.reduce(
        (acc, ruleSet) => {
          return { ...acc, ...(ruleSet.violations || {}) };
        },
        {} as Record<string, Violation>,
      );
    }

    const lowercaseSearchTerm = searchTerm.toLowerCase();
    return ruleSets.reduce(
      (acc, ruleSet) => {
        return Object.entries(ruleSet.violations || {}).reduce(
          (innerAcc, [violationId, violation]) => {
            const matchingIncidents = violation.incidents.filter(
              (incident) =>
                incident.message.toLowerCase().includes(lowercaseSearchTerm) ||
                incident.uri.toLowerCase().includes(lowercaseSearchTerm),
            );

            if (
              matchingIncidents.length > 0 ||
              violation.description.toLowerCase().includes(lowercaseSearchTerm)
            ) {
              innerAcc[violationId] = {
                ...violation,
                incidents: matchingIncidents,
              };
            }

            return innerAcc;
          },
          acc,
        );
      },
      {} as Record<string, Violation>,
    );
  }, [ruleSets, searchTerm]);

  const renderViolation = useCallback(
    (violationId: string, violation: Violation) => {
      const isExpanded = expandedViolations.has(violationId);

      return (
        <Card isCompact key={violationId} style={{ marginBottom: "10px" }}>
          <CardBody>
            <ExpandableSection
              toggleContent={
                <Tooltip content={violation.description}>
                  <Text className="truncate-text" style={{ maxWidth: "100%" }}>
                    {violation.description}
                  </Text>
                </Tooltip>
              }
              onToggle={() => toggleViolation(violationId)}
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
    [expandedViolations, handleIncidentClick, toggleViolation],
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
          {Object.entries(filteredViolations).map(([violationId, violation]) =>
            renderViolation(violationId, violation),
          )}
        </div>
      </StackItem>
    </Stack>
  );
};

export default ViolationIncidentsList;
