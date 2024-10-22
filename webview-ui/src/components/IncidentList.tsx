import "./incidentList.css";
import React from "react";
import {
  Card,
  CardBody,
  Label,
  Flex,
  FlexItem,
  Stack,
  StackItem,
  Content,
  ContentVariants,
} from "@patternfly/react-core";
import { FileIcon } from "@patternfly/react-icons";
import { Incident } from "@editor-extensions/shared";

interface IncidentListProps {
  incidents: Incident[];
  selectedIncident: Incident | null;
  onSelectIncident: (incident: Incident) => void;
}

const IncidentList: React.FC<IncidentListProps> = ({
  incidents,
  selectedIncident,
  onSelectIncident,
}: IncidentListProps) => {
  const getSeverityColor = (severity: string = "low") => {
    switch (severity.toLowerCase()) {
      case "high":
        return "red";
      case "medium":
        return "yellow";
      case "low":
        return "green";
      default:
        return "green";
    }
  };

  let sortedIncidents = incidents;
  if (selectedIncident) {
    sortedIncidents = incidents.filter(
      (incident) => incident.lineNumber !== selectedIncident.lineNumber,
    );
    sortedIncidents = [selectedIncident, ...sortedIncidents];
  }

  return (
    <Stack hasGutter className="incident-list-container">
      {sortedIncidents?.map((incident, index) => (
        <StackItem key={index}>
          <Card
            isDisabled={selectedIncident?.lineNumber !== incident.lineNumber}
            isSelected={selectedIncident?.lineNumber === incident.lineNumber}
            onClick={() => onSelectIncident(incident)}
            className={`incident-card ${selectedIncident?.lineNumber === incident.lineNumber ? "selected" : ""}`}
          >
            <CardBody className="incident-card-body">
              <Flex alignItems={{ default: "alignItemsCenter" }}>
                <FlexItem>
                  <FileIcon size={1} className="text-muted" />
                </FlexItem>
                <FlexItem grow={{ default: "grow" }}>
                  <Flex
                    alignItems={{ default: "alignItemsCenter" }}
                    spaceItems={{ default: "spaceItemsSm" }}
                  >
                    <FlexItem className="filename-text">
                      <Content component={ContentVariants.small}>
                        {incident.uri.split("/").pop() || ""}
                      </Content>
                    </FlexItem>
                    <FlexItem className="line-number">
                      <Content component={"small"}>
                        :{incident.lineNumber}
                      </Content>
                    </FlexItem>
                    <FlexItem>
                      <Label
                        isCompact
                        color={getSeverityColor(incident.severity)}
                      >
                        {incident.severity || "Low"}
                      </Label>
                    </FlexItem>
                  </Flex>
                </FlexItem>
              </Flex>
            </CardBody>
          </Card>
        </StackItem>
      ))}
    </Stack>
  );
};
export default IncidentList;
