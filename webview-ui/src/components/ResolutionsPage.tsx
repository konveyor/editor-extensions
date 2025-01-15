import React from "react";
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
  Alert,
} from "@patternfly/react-core";
import { CheckCircleIcon, WarningTriangleIcon } from "@patternfly/react-icons";
import spacing from "@patternfly/react-styles/css/utilities/Spacing/spacing";
import IncidentList from "./IncidentList";
import { FileChanges } from "./FileChanges";
import { CodePreview } from "./CodePreview";
import { LoadingScreen } from "./LoadingScreen";
import { LocalChange } from "@editor-extensions/shared";
import { useExtensionState } from "../hooks/useExtensionState";
import { applyFile, discardFile, viewFix } from "../hooks/actions";

const ResolutionPage: React.FC = () => {
  const [state, dispatch] = useExtensionState();
  const {
    localChanges,
    isAnalyzing,
    isFetchingSolution,
    isStartingServer,
    solutionData: resolution,
    solutionScope,
  } = state;
  const isLoading = isAnalyzing || isFetchingSolution || isStartingServer;
  const getRemainingFiles = () => {
    if (!resolution) {
      return [];
    }
    return localChanges.filter(({ state }) => state === "pending");
  };
  const isResolved = !!resolution && getRemainingFiles().length === 0;

  const handleFileClick = (change: LocalChange) => dispatch(viewFix(change));

  const handleAcceptClick = (change: LocalChange) => dispatch(applyFile(change));

  const handleRejectClick = (change: LocalChange) => dispatch(discardFile(change));

  // Display loading screen when fetching solution
  if (isLoading) {
    return (
      <Page>
        <PageSection className="pf-v5-u-px-xl pf-v5-u-py-md">
          <LoadingScreen />
        </PageSection>
      </Page>
    );
  }

  // Display "Changes Applied" when the solution is accepted
  if (isResolved) {
    return (
      <Page>
        <PageSection className="pf-v6-u-px-xl pf-v6-u-py-md">
          <EmptyState variant="lg" icon={CheckCircleIcon} titleText="Changes Applied">
            <EmptyStateBody>
              The changes have been processed. You can close this panel or wait for the next
              incident.
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
          <EmptyState variant="lg" icon={WarningTriangleIcon} titleText="No Active Solutions">
            <EmptyStateBody>There are no solutions to review at this time.</EmptyStateBody>
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

      {resolution.encountered_errors.length > 0 && (
        <PageSection className="pf-v5-u-px-xl">
          <Alert variant="warning" title="Encountered Errors">
            <ul>
              {resolution.encountered_errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </Alert>
        </PageSection>
      )}

      <PageSection className="pf-v5-u-px-xl">
        <Split hasGutter>
          <SplitItem>
            <Card isFullHeight className="incident-list-card">
              <CardTitle>
                {solutionScope?.violation?.description || "No Violation Data"}
                <Badge className={spacing.mSm}>
                  {solutionScope?.violation?.category ?? "optional"}
                </Badge>
              </CardTitle>
              <CardBody>
                <IncidentList
                  incidents={solutionScope?.incidents ?? []}
                  selectedIncident={solutionScope?.incidents?.[0]}
                  onSelectIncident={() => {}}
                />
              </CardBody>
            </Card>
          </SplitItem>

          <SplitItem isFilled>
            <Card className={spacing.mbSm}>
              <CardTitle>Affected Files</CardTitle>
              <CardBody>
                <FileChanges
                  changes={getRemainingFiles()}
                  onFileClick={handleFileClick}
                  onApplyFix={handleAcceptClick}
                  onRejectChanges={handleRejectClick}
                />
              </CardBody>
            </Card>
            {solutionScope?.incidents?.length && (
              <Card className="pf-v5-u-mb-md">
                <CardTitle>Incident Details</CardTitle>
                <CardBody>
                  <CodePreview incident={solutionScope?.incidents?.[0]} />
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
