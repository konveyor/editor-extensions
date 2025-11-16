import React from "react";
import { Progress, ProgressSize } from "@patternfly/react-core";

interface ProgressIndicatorProps {
  progress: number;
  message?: string;
}

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({ progress, message }) => {
  const title = message || "Analysis Progress";
  return <Progress value={progress} title={title} size={ProgressSize.sm} />;
};

export default ProgressIndicator;
