import React from "react";
import { Incident } from "../types";
import { TextContent, Text, TextVariants } from "@patternfly/react-core";

interface IncidentDetailsProps {
  incident: Incident | null;
}

const IncidentDetails: React.FC<IncidentDetailsProps> = ({ incident }) => {
  if (!incident) {
    return <div>Select an incident to see details.</div>;
  }

  return (
    <TextContent>
      <Text component={TextVariants.h3}>{incident.message}</Text>
      <Text component={TextVariants.p}>
        <strong>Severity:</strong> {incident.severity}
      </Text>
      <Text component={TextVariants.p}>
        <strong>File:</strong> {incident.file}
      </Text>
      <Text component={TextVariants.p}>
        <strong>Line:</strong> {incident.line}
      </Text>
    </TextContent>
  );
};

export default IncidentDetails;
