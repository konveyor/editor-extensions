import "./incidentTable.css";
import React, { FC, useCallback } from "react";
import { Content, Button, Card, CardBody, CardHeader } from "@patternfly/react-core";
import { EnhancedIncident, Incident } from "@editor-extensions/shared";
import { Table, Thead, Tr, Th, Tbody, Td, TableText } from "@patternfly/react-table";
import Markdown from "react-markdown";
import { getIncidentFile, getIncidentRelativeDir } from "../../utils/incident";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";
import GetSolutionDropdown from "../GetSolutionDropdown";

export interface IncidentTableProps {
  incidents: EnhancedIncident[];
  message: string;
  onIncidentSelect: (it: EnhancedIncident) => void;
  isReadOnly?: boolean;
}

export const IncidentTable: FC<IncidentTableProps> = ({
  incidents,
  message,
  isReadOnly = false,
  onIncidentSelect,
}) => {
  const { state } = useExtensionStateContext();
  const relativeDirname = useCallback(
    (incident: Incident) => {
      return getIncidentRelativeDir(incident, state.workspaceRoot);
    },
    [state.workspaceRoot],
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
            isReadOnly
              ? undefined
              : {
                  actions: <GetSolutionDropdown incidents={incidents} scope="in-between" />,
                }
          }
        >
          <Markdown>{message}</Markdown>
        </CardHeader>

        <Card isPlain>
          <CardBody>
            <Table aria-label="Incidents" variant="compact">
              <Thead>
                <Tr>
                  {isReadOnly ? (
                    <>
                      <Th width={60}>{ISSUE}</Th>
                      <Th width={40}>{LOCATION}</Th>
                    </>
                  ) : (
                    <>
                      <Th width={30}>{ISSUE}</Th>
                      <Th width={40}>{FOLDER}</Th>
                      <Th width={20}>{LOCATION}</Th>
                      <Th width={10} />
                    </>
                  )}
                </Tr>
              </Thead>
              <Tbody>
                {incidents.map((it) => (
                  <Tr key={uniqueId(it)}>
                    <Td dataLabel={ISSUE} width={isReadOnly ? 60 : 30}>
                      <TableText tooltip={it.uri} tooltipProps={tooltipProps}>
                        <Button
                          component="a"
                          variant="link"
                          isInline
                          onClick={() => onIncidentSelect(it)}
                        >
                          <b>{getIncidentFile(it)}</b>
                        </Button>
                      </TableText>
                    </Td>
                    {!isReadOnly && (
                      <Td dataLabel={FOLDER} width={40}>
                        <TableText
                          wrapModifier="truncate"
                          tooltip={relativeDirname(it)}
                          tooltipProps={tooltipProps}
                        >
                          <i>{relativeDirname(it)}</i>
                        </TableText>
                      </Td>
                    )}
                    <Td dataLabel={LOCATION} width={isReadOnly ? 40 : 20}>
                      <TableText wrapModifier="nowrap">
                        <Content component="p">
                          {it.lineNumber !== undefined ? `Line ${it.lineNumber}` : "No line number"}
                        </Content>
                      </TableText>
                    </Td>
                    {!isReadOnly && (
                      <Td width={10}>
                        <GetSolutionDropdown incidents={[it]} scope="incident" />
                      </Td>
                    )}
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
