import React, { useState } from "react";
import {
  Page,
  PageSection,
  Title,
  Badge,
  Card,
  CardBody,
  CardTitle,
  Flex,
  FlexItem,
  Split,
  SplitItem,
  EmptyState,
  EmptyStateBody,
} from "@patternfly/react-core";
import { CheckCircleIcon, WarningTriangleIcon } from "@patternfly/react-icons";
import spacing from "@patternfly/react-styles/css/utilities/Spacing/spacing";
import IncidentList from "./IncidentList";
import { FileChanges } from "./FileChanges";
import { CodePreview } from "./CodePreview";
import { Change, ResolutionMessage } from "@editor-extensions/shared";
import { useVscodeMessages } from "../hooks/useVscodeMessages";
import { sendVscodeMessage } from "../utils/vscodeMessaging";

const ResolutionPage: React.FC = () => {
  const [resolution, setResolution] = useState<ResolutionMessage | null>(null);
  const [isResolved, setIsResolved] = useState(false);
  const [processedChanges, setProcessedChanges] = useState<Set<string>>(
    new Set(),
  );

  const messageHandler = (message: any) => {
    if (message.type === "loadResolution") {
      // Only call `handleSolutionResult` if there is a solution in the message
      if (message.solution) {
        handleSolutionResult(message);
      } else {
        console.log("No solution found for the incident.");
        setResolution(null);
        setIsResolved(false);
        setProcessedChanges(new Set());
      }

      sendVscodeMessage("setSharedState", {
        key: "resolutionPanelData",
        value: message,
      });
    }
  };

  useVscodeMessages(messageHandler);

  // Check if the solution is relevant to the selected incident
  const handleSolutionResult = (resolutionMessage: ResolutionMessage) => {
    if (resolutionMessage?.isRelevantSolution) {
      // Relevant solution found, process or display it
      console.log(
        "Relevant solution found for this incident:",
        resolutionMessage,
      );
      setResolution(resolutionMessage);
      setIsResolved(false);
      setProcessedChanges(new Set());
    } else {
      // No relevant solution for the selected incident
      console.log("No relevant solution for this incident.");
      setResolution(null);
      setIsResolved(false);
      setProcessedChanges(new Set());

      sendVscodeMessage("setSharedState", {
        key: "resolutionPanelData",
        value: null,
      });
      sendVscodeMessage("solutionResolved", {});
    }
  };

  const handleFileClick = (change: Change) => {
    sendVscodeMessage("viewFix", {
      change, // Send the Change data for the file to be opened
      incident: resolution?.incident,
    });
  };

  const handleAcceptClick = (change: Change) => {
    sendVscodeMessage("applyFile", {
      change, // Send the Change data for the file to be opened
      incident: resolution?.incident,
    });

    const newProcessedChanges = new Set(processedChanges);
    newProcessedChanges.add(change.modified);
    setProcessedChanges(newProcessedChanges);

    // Check if all changes have been processed
    const totalChanges = resolution?.solution.changes?.length || 0;
    if (newProcessedChanges.size === totalChanges) {
      setIsResolved(true);
      sendVscodeMessage("solutionResolved", {});
    }
  };

  const handleRejectClick = (change: Change) => {
    sendVscodeMessage("revertFile", {
      change, // Send the Change data for the file to be opened
      incident: resolution
        ? resolution.incident
        : { uri: "", lineNumber: 0, message: "" },
    });

    const newProcessedChanges = new Set(processedChanges);
    newProcessedChanges.add(change.modified);
    setProcessedChanges(newProcessedChanges);

    // Check if all changes have been processed
    const totalChanges = resolution?.solution.changes?.length || 0;
    if (newProcessedChanges.size === totalChanges) {
      setIsResolved(true);
      sendVscodeMessage("solutionResolved", {});
    }
  };

  const getRemainingChanges = () => {
    if (!resolution?.solution.changes) {
      return [];
    }
    return resolution.solution.changes.filter(
      (change) => !processedChanges.has(change.modified),
    );
  };

  // Display "Changes Applied" when the solution is accepted
  if (isResolved) {
    return (
      <Page>
        <PageSection
          className="pf-v6-u-px-xl pf-v6-u-py-md"
          title="Changes Applied"
        >
          <EmptyState
            variant="lg"
            icon={CheckCircleIcon}
            titleText="Changes Applied"
          >
            <EmptyStateBody>
              The changes have been processed. You can close this panel or wait
              for the next incident.
            </EmptyStateBody>
          </EmptyState>
        </PageSection>
      </Page>
    );
  }

  // Display "No Active Solutions" when no resolution exists
  if (!resolution) {
    return (
      <Page>
        <PageSection className="pf-v5-u-px-xl pf-v5-u-py-md">
          <EmptyState
            variant="lg"
            icon={WarningTriangleIcon}
            titleText="No Active Solutions"
          >
            <EmptyStateBody>
              There are no solutions to review at this time.
            </EmptyStateBody>
          </EmptyState>
        </PageSection>
      </Page>
    );
  }

  return (
    <Page>
      <PageSection className="pf-v5-u-px-xl pf-v5-u-py-md">
        <Flex>
          <FlexItem>
            <Title headingLevel="h1" size="2xl">
              <Flex spaceItems={{ default: "spaceItemsMd" }}>
                <FlexItem>
                  <WarningTriangleIcon className="pf-v5-u-danger-color-100" />
                </FlexItem>
                <FlexItem>Kai Results</FlexItem>
              </Flex>
            </Title>
          </FlexItem>
        </Flex>
      </PageSection>

      <PageSection className="pf-v5-u-px-xl">
        <Split hasGutter>
          <SplitItem>
            <Card isFullHeight className="incident-list-card">
              <CardTitle>
                {resolution?.violation.description || "No Violation Data"}
                <Badge className={spacing.mSm}>
                  {resolution?.violation.category}
                </Badge>
              </CardTitle>
              <CardBody>
                <IncidentList
                  incidents={resolution?.violation.incidents}
                  selectedIncident={resolution?.incident}
                  onSelectIncident={(incident) => {}}
                />
              </CardBody>
            </Card>
          </SplitItem>

          <SplitItem isFilled>
            <Card className={spacing.mbSm}>
              <CardTitle>Affected Files</CardTitle>
              <CardBody>
                <FileChanges
                  changes={getRemainingChanges()}
                  onFileClick={handleFileClick}
                  onApplyFix={handleAcceptClick}
                  onRejectChanges={handleRejectClick}
                />
              </CardBody>
            </Card>
            {resolution?.incident && (
              <Card className="pf-v5-u-mb-md">
                <CardTitle>Incident Details</CardTitle>
                <CardBody>
                  <CodePreview incident={resolution.incident} />
                </CardBody>
              </Card>
            )}
          </SplitItem>
        </Split>
      </PageSection>
    </Page>
  );
};

export default ResolutionPage;
