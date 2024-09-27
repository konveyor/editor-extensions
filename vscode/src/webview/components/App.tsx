import React, { useState, useEffect } from "react";
import { Incident } from "../types";
import { vscode } from "../globals";
import {
  Page,
  PageSection,
  PageSectionVariants,
  Title,
  EmptyState,
  EmptyStateIcon,
  EmptyStateBody,
  Button,
} from "@patternfly/react-core";
import { SearchIcon } from "@patternfly/react-icons";
import IncidentList from "./IncidentList";

const App: React.FC = () => {
  const [incidents, setIncidents] = useState<Incident[]>([]);

  useEffect(() => {
    vscode.postMessage({ command: "requestIncidentData" });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case "incidentData":
          if (message.data && message.data.length > 0) {
            setIncidents(message.data);
          }
          break;
        // Handle other messages...
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  return (
    <Page>
      <PageSection variant={PageSectionVariants.light}>
        <Title headingLevel="h1">Konveyor Analysis Results</Title>
      </PageSection>
      <PageSection>
        {incidents.length > 0 ? (
          <IncidentList incidents={incidents} />
        ) : (
          <EmptyState>
            <EmptyStateIcon icon={SearchIcon} />
            <Title headingLevel="h4" size="lg">
              No Incidents Found
            </Title>
            <EmptyStateBody>Run an analysis to see results here.</EmptyStateBody>
            <Button
              variant="primary"
              onClick={() => vscode.postMessage({ command: "startAnalysis" })}
            >
              Run Analysis
            </Button>
          </EmptyState>
        )}
      </PageSection>
    </Page>
  );
};

export default App;
