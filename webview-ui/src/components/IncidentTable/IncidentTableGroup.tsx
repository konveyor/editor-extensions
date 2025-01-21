import React from "react";
import { Incident, Violation } from "@editor-extensions/shared";
import { groupIncidentsByMsg } from "../../utils/transformation";
import { IncidentTable } from "./IncidentTable";

export const IncidentTableGroup = ({
  violation,
  onIncidentSelect,
  onGetSolution,
  workspaceRoot,
}: {
  violation: Violation;
  onIncidentSelect: (incident: Incident) => void;
  onGetSolution: (incidents: Incident[], violation: Violation) => void;
  workspaceRoot: string;
}) => {
  const items: [string, Incident[]][] = Object.entries(
    groupIncidentsByMsg(violation.incidents),
  ).map(([message, tuples]) => [message, tuples.map(([, incident]) => incident)]);

  return items.map(([message, incidents]) => (
    <IncidentTable
      onIncidentSelect={onIncidentSelect}
      key={message}
      message={message}
      getSolution={(incidents: Incident[]) => onGetSolution(incidents, violation)}
      incidents={incidents}
      workspaceRoot={workspaceRoot}
    />
  ));
};
