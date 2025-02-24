import React from "react";
import { EnhancedIncident } from "@editor-extensions/shared";
import { IncidentTable } from "./IncidentTable";

export const IncidentTableGroup = ({
  onIncidentSelect,
  onGetSolution,
  workspaceRoot,
  incidents,
}: {
  onIncidentSelect: (incident: EnhancedIncident) => void;
  onGetSolution?: (incidents: EnhancedIncident[]) => void;
  workspaceRoot: string;
  incidents?: EnhancedIncident[];
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
      getSolution={
        onGetSolution ? (incidents: EnhancedIncident[]) => onGetSolution(incidents) : undefined
      }
      incidents={incidents}
      workspaceRoot={workspaceRoot}
    />
  ));
};
