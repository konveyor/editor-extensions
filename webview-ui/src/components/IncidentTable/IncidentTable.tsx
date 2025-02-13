import "./incidentTable.css";
import React, { FC, useCallback } from "react";
import { Content, Button, Card, CardBody, CardHeader, Checkbox } from "@patternfly/react-core";
import { EnhancedIncident, Incident } from "@editor-extensions/shared";
import { Table, Thead, Tr, Th, Tbody, Td, TableText } from "@patternfly/react-table";
import * as path from "path-browserify";
import Markdown from "react-markdown";
import spacing from "@patternfly/react-styles/css/utilities/Spacing/spacing";

export interface IncidentTableProps {
  workspaceRoot: string;
  incidents: EnhancedIncident[];
  message: string;
  onIncidentSelect: (it: EnhancedIncident) => void;
  selectedIncidents?: Set<string>;
  onIncidentSelectionChange?: (incidentId: string, isSelected: boolean) => void;
}

export const IncidentTable: FC<IncidentTableProps> = ({
  incidents,
  message,
  workspaceRoot,
  onIncidentSelect,
  selectedIncidents,
  onIncidentSelectionChange,
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

  const tooltipProps = {
    className: "incident-table-tooltip",
    distance: 15,
  };

  const isSelectable = selectedIncidents !== undefined && onIncidentSelectionChange !== undefined;
  const allSelected =
    isSelectable && incidents.every((incident) => selectedIncidents.has(uniqueId(incident)));

  // const handleSelectAll = (checked: boolean) => {
  //   if (onIncidentSelectionChange) {
  //     incidents.forEach((incident) => {
  //       onIncidentSelectionChange(uniqueId(incident), checked);
  //     });
  //   }
  // };

  const ISSUE = "Issue";
  const LOCATION = "Location";
  const FOLDER = "Folder";

  return (
    <>
      <Card isPlain>
        <CardHeader>
          <Markdown>{message}</Markdown>
        </CardHeader>

        <Card isPlain>
          <CardBody>
            <Table aria-label="Incidents" variant="compact">
              <Thead>
                <Tr>
                  {/* {isSelectable && (
                    <Th width={10}>
                      <Checkbox
                        id={`select-all-${message}`}
                        aria-label="Select all incidents"
                        isChecked={allSelected}
                        onChange={(_event, checked) => handleSelectAll(checked)}
                      />
                    </Th>
                  )} */}
                  <Th width={10} />
                  <Th width={40}>{ISSUE}</Th>
                  <Th width={30}>{FOLDER}</Th>
                  <Th width={20}>{LOCATION}</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {incidents.map((it) => (
                  <Tr key={uniqueId(it)}>
                    {isSelectable && (
                      <Td>
                        <Checkbox
                          id={`select-incident-${uniqueId(it)}`}
                          aria-label={`Select incident ${fileName(it)}`}
                          isChecked={selectedIncidents.has(uniqueId(it))}
                          onChange={(_event, checked) =>
                            onIncidentSelectionChange(uniqueId(it), checked)
                          }
                        />
                      </Td>
                    )}
                    <Td dataLabel={ISSUE}>
                      <TableText
                        wrapModifier="truncate"
                        tooltip={it.uri}
                        tooltipProps={tooltipProps}
                      >
                        <a href="#" onClick={() => onIncidentSelect(it)}>
                          <b>{fileName(it)}</b>
                        </a>
                      </TableText>
                    </Td>
                    <Td dataLabel={FOLDER} width={30} className={spacing.prMd}>
                      <TableText
                        wrapModifier="truncate"
                        tooltip={relativeDirname(it)}
                        tooltipProps={tooltipProps}
                      >
                        <i className={spacing.prSm}>{relativeDirname(it)}</i>
                      </TableText>
                    </Td>
                    <Td dataLabel={LOCATION}>
                      <TableText wrapModifier="nowrap">
                        <Content component="p">
                          {it.lineNumber !== undefined ? `Line ${it.lineNumber}` : "No line number"}
                        </Content>
                      </TableText>
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
