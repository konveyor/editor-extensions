import "./incidentTable.css";
import React, { FC } from "react";
import { Button, Card, CardBody, CardHeader } from "@patternfly/react-core";
import { EnhancedIncident } from "@editor-extensions/shared";
import { Table, Thead, Tr, Th, Tbody, Td, TableText } from "@patternfly/react-table";
import Markdown from "react-markdown";
import { getIncidentRelativePath } from "../../utils/incident";
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
  const uniqueId = (incident: EnhancedIncident) => `${incident.uri}-${incident.lineNumber}`;

  const tooltipProps = {
    className: "incident-table-tooltip",
    distance: 15,
  };

  const ISSUE = "Issue";

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
                      <Th width={100}>{ISSUE}</Th>
                    </>
                  ) : (
                    <>
                      <Th width={90}>{ISSUE}</Th>
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
                          <b>
                            {getIncidentRelativePath(it, state.workspaceRoot)}:{it.lineNumber}
                          </b>
                        </Button>
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
