import React from "react";
import { Violation } from "../types";
import { List, ListItem, ListVariant, Badge } from "@patternfly/react-core";

interface ViolationsListProps {
  violations: { [key: string]: Violation };
  selectedViolation: string | null;
  onViolationClick: (violationId: string) => void;
}

const ViolationsList: React.FC<ViolationsListProps> = ({
  violations,
  selectedViolation,
  onViolationClick,
}) => {
  return (
    <List variant={ListVariant.inline}>
      {Object.entries(violations).map(([id, violation]) => (
        <ListItem
          key={id}
          onClick={() => onViolationClick(id)}
          //   isActive={id === selectedViolation}
          style={{ cursor: "pointer" }}
        >
          <span>{violation.description}</span>
          <Badge isRead>{violation.incidents.length}</Badge>
        </ListItem>
      ))}
    </List>
  );
};

export default ViolationsList;
