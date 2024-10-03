import React, { useState } from "react";
import { Violation, Incident } from "../types";
import {
  Split,
  SplitItem,
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
} from "@patternfly/react-core";
import { ArrowRightIcon } from "@patternfly/react-icons";
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

  return (
    <Split>
      <SplitItem isFilled>
        <List variant={ListVariant.inline}>
          {violation.incidents.map((incident) => (
            <ListItem
              key={incident.id}
              onClick={() => handleIncidentClick(incident)}
              //   isActive={selectedIncident?.id === incident.id}
              style={{ cursor: "pointer" }}
            >
              <Split>
                <SplitItem isFilled>
                  <span>{incident.message}</span>
                </SplitItem>
                <SplitItem>
                  <Label>{incident.severity}</Label>
                </SplitItem>
                <SplitItem>
                  <Button variant="link" icon={<ArrowRightIcon />} />
                </SplitItem>
              </Split>
            </ListItem>
          ))}
        </List>
      </SplitItem>
      {selectedIncident && (
        <SplitItem>
          <Card>
            <CardTitle>Incident Details</CardTitle>
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
        </SplitItem>
      )}
    </Split>
  );
};

export default IncidentsPanel;
