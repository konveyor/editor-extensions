import React from "react";
import { Incident } from "../types";
import { vscode } from "../globals";
import {
  DataList,
  DataListItem,
  DataListItemRow,
  DataListItemCells,
  DataListCell,
  DataListAction,
  Button,
  Label,
} from "@patternfly/react-core";
import {
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InfoCircleIcon,
} from "@patternfly/react-icons";

interface IncidentListProps {
  incidents: Incident[];
}

const severityIconMap = {
  High: <ExclamationCircleIcon color="var(--pf-global--danger-color--100)" />,
  Medium: <ExclamationTriangleIcon color="var(--pf-global--warning-color--100)" />,
  Low: <InfoCircleIcon color="var(--pf-global--info-color--100)" />,
};

const IncidentList: React.FC<IncidentListProps> = ({ incidents }) => {
  const handleIncidentClick = (incident: Incident) => {
    vscode.postMessage({
      command: "openFile",
      file: incident.file,
      line: incident.line,
    });
  };

  if (!incidents || incidents.length === 0) {
    return <div>No incidents found.</div>;
  }

  return (
    <DataList aria-label="List of Incidents">
      {incidents.map((incident) => (
        <DataListItem key={incident.id} aria-labelledby={`incident-${incident.id}`}>
          <DataListItemRow>
            <DataListItemCells
              dataListCells={[
                <DataListCell key="icon">{severityIconMap[incident.severity]}</DataListCell>,
                <DataListCell key="primary content">
                  <div id={`incident-${incident.id}`}>
                    <strong>{incident.message}</strong>
                  </div>
                  <div>
                    <Label>{incident.severity}</Label>
                  </div>
                  <div>File: {incident.file}</div>
                  <div>Line: {incident.line}</div>
                </DataListCell>,
              ]}
            />
            <DataListAction
              aria-labelledby={`incident-${incident.id} action`}
              id={`incident-${incident.id}-action`}
              aria-label="Actions"
            >
              <Button variant="secondary" onClick={() => handleIncidentClick(incident)}>
                Open
              </Button>
            </DataListAction>
          </DataListItemRow>
        </DataListItem>
      ))}
    </DataList>
  );
};

export default IncidentList;
