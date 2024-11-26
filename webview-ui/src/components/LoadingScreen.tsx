import React, { useState, useEffect } from "react";
import { EmptyState, EmptyStateBody, Spinner } from "@patternfly/react-core";

const thoughtMessages = [
  "Analyzing your code...",
  "Identifying potential solutions...",
  "Evaluating best practices...",
  "Considering migration paths...",
  "Checking compatibility...",
  "Preparing recommendations...",
  "Validating changes...",
  "Generating solution...",
];

export const LoadingScreen: React.FC = () => {
  const [currentMessage, setCurrentMessage] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentMessage((prev) => (prev + 1) % thoughtMessages.length);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return (
    <EmptyState variant="lg" icon={Spinner}>
      <EmptyStateBody>
        <div className="pf-v5-u-my-xl">
          <span className="pf-v5-u-font-size-lg">{thoughtMessages[currentMessage]}</span>
        </div>
      </EmptyStateBody>
    </EmptyState>
  );
};
