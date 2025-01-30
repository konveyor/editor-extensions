import React from "react";
import { EnhancedViolation, EnhancedIncident } from "@editor-extensions/shared";
import { enhanceIncidents } from "../../utils/transformation";
import { IncidentTable } from "./IncidentTable";

export const IncidentTableGroup = ({
  violation,
  onIncidentSelect,
  onGetSolution,
  workspaceRoot,
  incidents,
}: {
  violation?: EnhancedViolation;
  onIncidentSelect: (incident: EnhancedIncident) => void;
  onGetSolution?: (incidents: EnhancedIncident[]) => void;
  workspaceRoot: string;
  incidents?: EnhancedIncident[];
}) => {
  const enhancedIncidentsFromViolation = enhanceIncidents(incidents, violation);
  const groupedIncidents = incidents ?? enhancedIncidentsFromViolation;

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
        violation && onGetSolution
          ? (incidents: EnhancedIncident[]) => onGetSolution(incidents)
          : undefined
      }
      incidents={incidents}
      workspaceRoot={workspaceRoot}
    />
  ));
};
