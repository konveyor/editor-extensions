import React from "react";
import { Table, Thead, Tbody, Tr, Th, Td } from "@patternfly/react-table";
import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core";

interface Incident {
  id: string;
  title: string;
  severity: "Low" | "Medium" | "High" | "Critical";
  status: "Open" | "In Progress" | "Resolved" | "Closed";
  lastUpdated: string;
}

interface IncidentsListProps {
  incidents: Incident[];
}

const IncidentsList: React.FC<IncidentsListProps> = ({ incidents }) => {
  const [sortBy, setSortBy] = React.useState({
    index: 0,
    direction: "asc" as "asc" | "desc",
  });

  const columns = ["ID", "Title", "Severity", "Status", "Last Updated"];

  const onSort = (index: number) => {
    setSortBy((prev) => ({
      index,
      direction: prev.index === index && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const sortedIncidents = [...incidents].sort((a, b) => {
    const aValue = Object.values(a)[sortBy.index];
    const bValue = Object.values(b)[sortBy.index];
    if (aValue < bValue) {
      return sortBy.direction === "asc" ? -1 : 1;
    }
    if (aValue > bValue) {
      return sortBy.direction === "asc" ? 1 : -1;
    }
    return 0;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Incidents</CardTitle>
      </CardHeader>
      <CardBody>
        <Table aria-label="Sortable Table">
          <Thead>
            <Tr>
              {columns.map((column, index) => (
                <Th key={index} onClick={() => onSort(index)}>
                  {column}
                  {sortBy.index === index && (sortBy.direction === "asc" ? " ▲" : " ▼")}
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            {sortedIncidents.map((incident, rowIndex) => (
              <Tr key={rowIndex}>
                {Object.values(incident).map((value, cellIndex) => (
                  <Td key={cellIndex}>{value}</Td>
                ))}
              </Tr>
            ))}
          </Tbody>
        </Table>
      </CardBody>
    </Card>
  );
};

export default IncidentsList;
