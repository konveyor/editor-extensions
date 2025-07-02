import "./incidentTable.css";
import React, { FC } from "react";
import { Button, Card, CardBody, CardHeader, Flex, Label } from "@patternfly/react-core";
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

  // Helper function to get success rate from any incident in the group
  const getSuccessRate = (incidents: EnhancedIncident[]) => {
    // Find the first incident with success rate data
    return incidents.find((incident) => incident.successRateMetric)?.successRateMetric;
  };

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
          <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsSm" }}>
            <Markdown>{message}</Markdown>
            {(() => {
              const successRate = getSuccessRate(incidents);
              return (
                successRate && (
                  <Flex spaceItems={{ default: "spaceItemsXs" }}>
                    {successRate.accepted_solutions > 0 && (
                      <Label color="green" isCompact>
                        {successRate.accepted_solutions} accepted
                      </Label>
                    )}
                    {successRate.rejected_solutions > 0 && (
                      <Label color="red" isCompact>
                        {successRate.rejected_solutions} rejected
                      </Label>
                    )}
                  </Flex>
                )
              );
            })()}
          </Flex>
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
