import React from "react";
import { Progress, ProgressSize } from "@patternfly/react-core";

interface ProgressIndicatorProps {
  progress: number;
}

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({ progress }) => {
  return <Progress value={progress} title="Analysis Progress" size={ProgressSize.sm} />;
};

export default ProgressIndicator;
