import "./incidentTable.css";
import React, { FC, useCallback } from "react";
import { Content, Button, Card, CardBody, CardHeader } from "@patternfly/react-core";
import { EnhancedIncident, Incident } from "@editor-extensions/shared";
import { Table, Thead, Tr, Th, Tbody, Td, TableText } from "@patternfly/react-table";
import * as path from "path-browserify";
import Markdown from "react-markdown";
import { WrenchIcon } from "@patternfly/react-icons";
import { getIncidentRelativeDir } from "../../utils/incident";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";

export interface IncidentTableProps {
  workspaceRoot: string;
  incidents: EnhancedIncident[];
  message: string;
  getSolution?: (incidents: EnhancedIncident[]) => void;
  onIncidentSelect: (it: EnhancedIncident) => void;
}

export const IncidentTable: FC<IncidentTableProps> = ({
  incidents,
  message,
  getSolution,
  workspaceRoot,
  onIncidentSelect,
}) => {
  const { state } = useExtensionStateContext();
  const isGetSolutionDisabled =
    state.isFetchingSolution || state.isAnalyzing || state.serverState !== "running";

  const fileName = (incident: Incident) => path.basename(incident.uri);
  const relativeDirname = useCallback(
    (incident: Incident) => {
      return getIncidentRelativeDir(incident, workspaceRoot);
    },
    [workspaceRoot],
  );
  const uniqueId = (incident: Incident) => `${incident.uri}-${incident.lineNumber}`;

  const tooltipProps = {
    className: "incident-table-tooltip",
    distance: 15,
  };

  const ISSUE = "Issue";
  const LOCATION = "Location";
  const FOLDER = "Folder";
  return (
    <>
      <Card isPlain>
        <CardHeader
          actions={
            getSolution
              ? {
                  hasNoOffset: true,
                  actions: (
                    <Button
                      disabled={isGetSolutionDisabled}
                      variant="plain"
                      aria-label={
                        incidents.length === 1
                          ? "Resolve 1 incident"
                          : `Resolve ${incidents.length} incidents`
                      }
                      icon={<WrenchIcon />}
                      onClick={() => getSolution(incidents)}
                    >
                      {incidents.length === 1
                        ? "Resolve 1 incident"
                        : `Resolve ${incidents.length} incidents`}
                    </Button>
                  ),
                }
              : undefined
          }
        >
          <Markdown>{message}</Markdown>
        </CardHeader>

        <Card isPlain>
          <CardBody>
            <Table aria-label="Incidents" variant="compact">
              <Thead>
                <Tr>
                  <Th>{ISSUE}</Th>
                  <Th width={50}>{FOLDER}</Th>
                  <Th>{LOCATION}</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {incidents.map((it) => (
                  <Tr key={uniqueId(it)}>
                    <Td dataLabel={ISSUE}>
                      <TableText tooltip={it.uri} tooltipProps={tooltipProps}>
                        <Button component="a" variant="link" onClick={() => onIncidentSelect(it)}>
                          <b>{fileName(it)}</b>
                        </Button>
                      </TableText>
                    </Td>
                    <Td dataLabel={FOLDER}>
                      <TableText
                        wrapModifier="truncate"
                        tooltip={relativeDirname(it)}
                        tooltipProps={tooltipProps}
                      >
                        <i>{relativeDirname(it)}</i>
                      </TableText>
                    </Td>
                    <Td dataLabel={LOCATION}>
                      <TableText wrapModifier="nowrap">
                        <Content component="p">
                          {it.lineNumber !== undefined ? `Line ${it.lineNumber}` : "No line number"}
                        </Content>
                      </TableText>
                    </Td>
                    <Td isActionCell>
                      {getSolution && (
                        <Button
                          variant="plain"
                          aria-label="Resolve this incident"
                          icon={<WrenchIcon />}
                          onClick={() => getSolution([it])}
                        >
                          Resolve
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </CardBody>
        </Card>
      </Card>
    </>
  );
};
