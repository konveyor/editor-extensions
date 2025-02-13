import React from "react";
import { EnhancedIncident } from "@editor-extensions/shared";
import { IncidentTable } from "./IncidentTable";

interface IncidentTableGroupProps {
  onIncidentSelect: (incident: EnhancedIncident) => void;
  workspaceRoot: string;
  incidents?: EnhancedIncident[];
  selectedIncidents?: Set<string>;
  onIncidentSelectionChange?: (incidentId: string, isSelected: boolean) => void;
}

export const IncidentTableGroup: React.FC<IncidentTableGroupProps> = ({
  onIncidentSelect,
  workspaceRoot,
  incidents,
  selectedIncidents,
  onIncidentSelectionChange,
}) => {
  const groupedIncidents = incidents || [];

  // Group incidents by message for display
  const messageGroups = groupedIncidents.reduce(
    (groups, incident) => {
      if (!groups[incident.message]) {
        groups[incident.message] = [];
      }
      groups[incident.message].push(incident);
      return groups;
    },
    {} as Record<string, EnhancedIncident[]>,
  );

  return Object.entries(messageGroups).map(([message, incidents]) => (
    <IncidentTable
      onIncidentSelect={onIncidentSelect}
      key={message}
      message={message}
      incidents={incidents}
      workspaceRoot={workspaceRoot}
      selectedIncidents={selectedIncidents}
      onIncidentSelectionChange={onIncidentSelectionChange}
    />
  ));
};
