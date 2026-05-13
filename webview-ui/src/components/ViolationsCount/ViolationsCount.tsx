import "./styles.css";
import React from "react";
import { Content } from "@patternfly/react-core";
import spacing from "@patternfly/react-styles/css/utilities/Spacing/spacing";

interface ViolationsCountProps {
  violationsCount: number;
  incidentsCount: number;
}

export const ViolationsCount: React.FC<ViolationsCountProps> = ({
  violationsCount,
  incidentsCount,
}) => {
  const getStatusText = (count: number) => {
    if (count === 0) {
      return "(No incidents found)";
    } else if (count === 1) {
      return "(1 incident found)";
    } else {
      return `(${count} incidents found)`;
    }
  };

  return (
    <div className="violations-count">
      <Content component={"h4"} className="violations-title">
        Total Issues: {violationsCount}
      </Content>
      <Content component={"small"} className={`${spacing.mlSm} violations-subtitle`}>
        {getStatusText(incidentsCount)}
      </Content>
    </div>
  );
};
