import React, { FC, useCallback } from "react";
import { Incident } from "@editor-extensions/shared";
import * as path from "path-browserify";
import Markdown from "react-markdown";
import { Button } from "@patternfly/react-core";
import { WrenchIcon } from "@patternfly/react-icons";
import "./styles.css";

export interface IncidentTableProps {
  workspaceRoot: string;
  incidents: Incident[];
  message: string;
  getSolution?: (incidents: Incident[]) => void;
  onIncidentSelect: (it: Incident) => void;
}

export const IncidentTable: FC<IncidentTableProps> = ({
  incidents,
  message,
  getSolution,
  workspaceRoot,
  onIncidentSelect,
}) => {
  const fileName = (incident: Incident) => path.basename(incident.uri);
  const relativeDirname = useCallback(
    (incident: Incident) => {
      const dir = path.dirname(incident.uri);
      const re = new RegExp(`^${workspaceRoot}\\/*`);
      return dir.replace(re, "");
    },
    [workspaceRoot],
  );
  const uniqueId = (incident: Incident) => `${incident.uri}-${incident.lineNumber}`;

  return (
    <div className="incident-table-container">
      <div className="incident-card">
        <div className="incident-card-header">
          <div className="incident-card-header-content">
            <Markdown>{message}</Markdown>
          </div>
          {getSolution && (
            <Button
              variant="link"
              icon={<WrenchIcon className="pf-v6-u-mr-xs" />}
              onClick={() => getSolution(incidents)}
              title={
                incidents.length === 1
                  ? "Resolve this incident"
                  : `Resolve ${incidents.length} incidents`
              }
            >
              {incidents.length === 1 ? "Resolve" : `Resolve (${incidents.length})`}
            </Button>
          )}
        </div>

        <div className="incident-card-body">
          <table className="incident-table">
            <thead>
              <tr>
                <th className="col-issue">Issue</th>
                <th className="col-folder">Folder</th>
                <th className="col-location">Location</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((it) => (
                <tr key={uniqueId(it)}>
                  <td>
                    <Button
                      variant="link"
                      isInline
                      className="incident-link"
                      onClick={() => onIncidentSelect(it)}
                      title={fileName(it)}
                    >
                      {fileName(it)}
                    </Button>
                  </td>
                  <td>
                    <span className="folder-path" title={relativeDirname(it)}>
                      {relativeDirname(it)}
                    </span>
                  </td>
                  <td>
                    <span className="line-number">Line {it.lineNumber ?? ""}</span>
                  </td>
                  <td className="resolve-button-cell">
                    {getSolution && (
                      <Button
                        variant="plain"
                        icon={<WrenchIcon />}
                        onClick={() => getSolution([it])}
                        title="Resolve this incident"
                        className="pf-v5-u-p-sm"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
