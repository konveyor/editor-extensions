import React from "react";
import { Incident, Violation } from "@editor-extensions/shared";
import { groupIncidentsByMsg } from "../../utils/transformation";
import { IncidentTable } from "./IncidentTable";

export const IncidentTableGroup = ({
  violation,
  onIncidentSelect,
  onGetSolution,
  workspaceRoot,
  incidents,
}: {
  violation?: Violation;
  onIncidentSelect: (incident: Incident) => void;
  onGetSolution?: (incidents: Incident[], violation: Violation) => void;
  workspaceRoot: string;
  incidents?: Incident[];
}) => {
  const items: [string, Incident[]][] = Object.entries(
    groupIncidentsByMsg(incidents ?? violation?.incidents ?? []),
  ).map(([message, tuples]) => [message, tuples.map(([, incident]) => incident)]);

  return items.map(([message, incidents]) => (
    <IncidentTable
      onIncidentSelect={onIncidentSelect}
      key={message}
      message={message}
      getSolution={
        violation && onGetSolution
          ? (incidents: Incident[]) => onGetSolution(incidents, violation)
          : undefined
      }
      incidents={incidents}
      workspaceRoot={workspaceRoot}
    />
  ));
};
