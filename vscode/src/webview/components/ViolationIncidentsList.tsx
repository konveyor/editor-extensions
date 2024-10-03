import React, { useState, useCallback, useRef } from "react";
import { RuleSet, Incident } from "../types";
import { VariableSizeList as List } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
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
  const listRef = useRef<List>(null);

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
    if (listRef.current) {
      listRef.current.resetAfterIndex(0);
    }
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
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const violationId = Object.keys(ruleSet.violations || {})[index];
      const violation = ruleSet.violations?.[violationId];

      if (!violation) {
        return null;
      }

      const isExpanded = expandedViolations.has(violationId);

      return (
        <div style={style}>
          <Card isCompact>
            <CardBody>
              <ExpandableSection
                toggleContent={
                  <Tooltip content={violation.description}>
                    <Text className="truncate-text">{violation.description}</Text>
                  </Tooltip>
                }
                onToggle={() => toggleViolation(violationId)}
                isExpanded={isExpanded}
              >
                <Flex direction={{ default: "column" }}>
                  <FlexItem>
                    <Text component={TextVariants.h4}>Incidents:</Text>
                  </FlexItem>
                  {violation.incidents.map((incident) => (
                    <FlexItem key={incident.id}>
                      <Tooltip content={incident.message}>
                        <Button
                          variant="link"
                          onClick={() => handleIncidentClick(incident)}
                          className="truncate-text"
                        >
                          {incident.message}
                        </Button>
                      </Tooltip>
                      <Badge>{incident.severity}</Badge>
                    </FlexItem>
                  ))}
                </Flex>
              </ExpandableSection>
            </CardBody>
          </Card>
        </div>
      );
    },
    [expandedViolations, handleIncidentClick, ruleSet.violations, toggleViolation],
  );

  const getItemSize = useCallback(
    (index: number) => {
      const violationId = Object.keys(ruleSet.violations || {})[index];
      const violation = ruleSet.violations?.[violationId];
      const isExpanded = expandedViolations.has(violationId);
      return isExpanded && violation ? 70 + violation.incidents.length * 40 : 70; // Increased base height
    },
    [expandedViolations, ruleSet.violations],
  );

  return (
    <Stack hasGutter>
      <StackItem isFilled>
        <AutoSizer>
          {({ width, height }) => (
            <List
              ref={listRef}
              height={height}
              itemCount={Object.keys(ruleSet.violations || {}).length}
              itemSize={getItemSize}
              width={width}
              overscanCount={5}
            >
              {renderViolation}
            </List>
          )}
        </AutoSizer>
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
