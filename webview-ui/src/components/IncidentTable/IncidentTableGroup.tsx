import React from "react";
import {
  Incident,
  Violation,
  EnhancedViolation,
  EnhancedIncident,
} from "@editor-extensions/shared";
import { enhanceIncidents, groupIncidentsByMsg } from "../../utils/transformation";
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
  const items: [string, EnhancedIncident[]][] = Object.entries(
    groupIncidentsByMsg(groupedIncidents ?? []),
  ).map(([message, tuples]) => [message, tuples.map(([, incident]) => incident)]);

  return items.map(([message, incidents]) => (
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
