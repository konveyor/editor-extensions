import React, { useState, useCallback } from "react";
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
} from "@patternfly/react-core";
import { ArrowLeftIcon } from "@patternfly/react-icons";
import { vscode } from "../globals";

interface ViolationIncidentsListProps {
  ruleSet: RuleSet;
}

const ViolationIncidentsList: React.FC<ViolationIncidentsListProps> = ({ ruleSet }) => {
  const [expandedViolations, setExpandedViolations] = useState<Set<string>>(new Set());
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

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
      file: incident.file,
      line: incident.line,
    });
  }, []);

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
      <StackItem isFilled>
        <div style={{ height: "100%", overflowY: "auto" }}>
          {Object.entries(ruleSet.violations || {}).map(([violationId, violation]) =>
            renderViolation(violationId, violation),
          )}
        </div>
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
                <strong>File:</strong> {selectedIncident.file}
              </Text>
              <Text component={TextVariants.p}>
                <strong>Line:</strong> {selectedIncident.line}
              </Text>
            </CardBody>
          </Card>
        </StackItem>
      )}
    </Stack>
  );
};

export default ViolationIncidentsList;
