import React, { FC, useCallback } from "react";
import { Content, Button, Card, CardBody, CardHeader } from "@patternfly/react-core";
import { Incident } from "@editor-extensions/shared";
import { Table, Thead, Tr, Th, Tbody, Td, TableText } from "@patternfly/react-table";
import * as path from "path-browserify";
import ViolationActionsDropdown from "../ViolationActionsDropdown";

export interface IncidentTableProps {
  workspaceRoot: string;
  incidents: Incident[];
  message: string;
  getSolution: (incidents: Incident[]) => void;
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

  const ISSUE = "Issue";
  const LOCATION = "Location";
  const FOLDER = "Folder";
  return (
    <>
      <Card isPlain>
        <CardHeader
          actions={{
            hasNoOffset: true,
            actions: (
              <ViolationActionsDropdown
                onGetAllSolutions={() => getSolution(incidents)}
                fixMessage={
                  incidents.length === 1
                    ? "Resolve 1 incident"
                    : `Resolve the ${incidents.length} incidents`
                }
              />
            ),
          }}
        >
          {message}
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
                      <Button component="a" variant="link" onClick={() => onIncidentSelect(it)}>
                        <b>{fileName(it)}</b>
                      </Button>
                    </Td>
                    <Td dataLabel={FOLDER}>
                      <TableText wrapModifier="truncate">
                        <i>{relativeDirname(it)}</i>
                      </TableText>
                    </Td>
                    <Td dataLabel={LOCATION}>
                      <TableText wrapModifier="nowrap">
                        <Content component="p">Line {it.lineNumber ?? ""}</Content>
                      </TableText>
                    </Td>
                    <Td isActionCell>
                      <ViolationActionsDropdown
                        onGetAllSolutions={() => getSolution([it])}
                        fixMessage="Resolve this incident"
                      />
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
