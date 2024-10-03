import React, { useState } from "react";
import { Violation, Incident } from "../types";
import {
  List,
  ListItem,
  ListVariant,
  Button,
  Label,
  Card,
  CardBody,
  CardTitle,
  TextContent,
  Text,
  TextVariants,
  Flex,
  FlexItem,
} from "@patternfly/react-core";
import { ArrowLeftIcon } from "@patternfly/react-icons";
import { vscode } from "../globals";

interface IncidentsPanelProps {
  violation: Violation | null;
}

const IncidentsPanel: React.FC<IncidentsPanelProps> = ({ violation }) => {
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

  if (!violation) {
    return <div>Select a violation to see incidents.</div>;
  }

  const handleIncidentClick = (incident: Incident) => {
    setSelectedIncident(incident);
    vscode.postMessage({
      command: "openFile",
      file: incident.file,
      line: incident.line,
    });
  };

  const handleBackClick = () => {
    setSelectedIncident(null);
  };

  if (selectedIncident) {
    return (
      <Card>
        <CardTitle>
          <Flex>
            <FlexItem>
              <Button
                variant="plain"
                icon={<ArrowLeftIcon />}
                onClick={handleBackClick}
                aria-label="Back to incidents list"
              />
            </FlexItem>
            <FlexItem>Incident Details</FlexItem>
          </Flex>
        </CardTitle>
        <CardBody>
          <TextContent>
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
          </TextContent>
        </CardBody>
      </Card>
    );
  }

  return (
    <List variant={ListVariant.inline}>
      {violation.incidents.map((incident) => (
        <ListItem
          key={incident.id}
          onClick={() => handleIncidentClick(incident)}
          style={{ cursor: "pointer" }}
        >
          <Flex>
            <FlexItem grow={{ default: "grow" }}>
              <span>{incident.message}</span>
            </FlexItem>
            <FlexItem>
              <Label>{incident.severity}</Label>
            </FlexItem>
          </Flex>
        </ListItem>
      ))}
    </List>
  );
};

export default IncidentsPanel;
