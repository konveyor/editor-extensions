import "./styles.css";

import React, { useState, useEffect } from "react";
import {
  Alert,
  AlertGroup,
  Backdrop,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Drawer,
  DrawerContent,
  DrawerContentBody,
  EmptyState,
  EmptyStateBody,
  ExpandableSectionToggle,
  Flex,
  FlexItem,
  Masthead,
  MastheadContent,
  MastheadMain,
  Page,
  PageSection,
  PageSidebar,
  PageSidebarBody,
  Spinner,
  Stack,
  StackItem,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from "@patternfly/react-core";

import {
  openFile,
  startServer,
  runAnalysis,
  stopServer,
  getSuccessRate,
} from "../../hooks/actions";
import { useViolations } from "../../hooks/useViolations";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";
import { WalkthroughDrawer } from "./WalkthroughDrawer/WalkthroughDrawer";
import { ConfigButton } from "./ConfigButton/ConfigButton";
import { ServerStatusToggle } from "../ServerStatusToggle/ServerStatusToggle";
import { ViolationsCount } from "../ViolationsCount/ViolationsCount";
import ViolationIncidentsList from "../ViolationIncidentsList";
import { ProfileSelector } from "../ProfileSelector/ProfileSelector";
import ProgressIndicator from "../ProgressIndicator";
import { Incident } from "@editor-extensions/shared";

const AnalysisPage: React.FC = () => {
  const { state, dispatch } = useExtensionStateContext();

  const {
    isAnalyzing,
    isStartingServer,
    isInitializingServer,
    isFetchingSolution: isWaitingForSolution,
    ruleSets: analysisResults,
    enhancedIncidents,
    configErrors,
    profiles,
    activeProfileId,
    serverState,
    solutionServerEnabled,
    localChanges,
  } = state;

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [focusedIncident, setFocusedIncident] = useState<Incident | null>(null);
  const [expandedViolations, setExpandedViolations] = useState<Set<string>>(new Set());
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  const violations = useViolations(analysisResults);
  const hasViolations = violations.length > 0;
  const hasAnalysisResults = !!analysisResults;
  const serverRunning = serverState === "running";

  const drawerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (enhancedIncidents.length > 0 && solutionServerEnabled) {
      dispatch(getSuccessRate());
      console.log("Fetching success rates for incidents...", enhancedIncidents);
    }
  }, [enhancedIncidents.length, localChanges.length, solutionServerEnabled, dispatch]);

  const handleIncidentSelect = (incident: Incident) => {
    setFocusedIncident(incident);
    dispatch(openFile(incident.uri, incident.lineNumber ?? 0));
  };

  const handleRunAnalysis = () => dispatch(runAnalysis());
  const handleServerToggle = () => dispatch(serverRunning ? stopServer() : startServer());

  const panelContent = (
    <WalkthroughDrawer
      isOpen={isConfigOpen}
      onClose={() => setIsConfigOpen(false)}
      drawerRef={drawerRef}
    />
  );

  const selectedProfile = profiles.find((p) => p.id === activeProfileId);

  const configInvalid =
    !selectedProfile?.labelSelector?.trim() ||
    (!selectedProfile.useDefaultRules && (selectedProfile.customRules?.length ?? 0) === 0);

  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Drawer isExpanded={isConfigOpen}>
      <DrawerContent panelContent={panelContent}>
        <DrawerContentBody>
          <Page
            sidebar={
              <PageSidebar isSidebarOpen={false}>
                <PageSidebarBody />
              </PageSidebar>
            }
            masthead={
              <Masthead>
                <MastheadMain />
                <MastheadContent>
                  <Toolbar>
                    <ToolbarContent>
                      <ToolbarGroup align={{ default: "alignEnd" }}>
                        <ToolbarItem>
                          <ServerStatusToggle
                            isRunning={serverRunning}
                            isStarting={isStartingServer}
                            isInitializing={isInitializingServer}
                            onToggle={handleServerToggle}
                            hasWarning={configInvalid}
                          />
                        </ToolbarItem>
                        <ToolbarItem>
                          <ConfigButton
                            onClick={() => setIsConfigOpen(true)}
                            hasWarning={configErrors.length > 0}
                            warningMessage="Please review your configuration before running analysis."
                          />
                        </ToolbarItem>
                      </ToolbarGroup>
                    </ToolbarContent>
                  </Toolbar>
                </MastheadContent>
              </Masthead>
            }
          >
            {!selectedProfile && (
              <PageSection padding={{ default: "noPadding" }}>
                <Card isCompact style={{ maxWidth: "600px", margin: "0 auto" }}>
                  <Alert variant="danger" title="No active profile selected">
                    Please select or create a profile before running an analysis.
                    <Button
                      variant="link"
                      onClick={() => dispatch({ type: "OPEN_PROFILE_MANAGER", payload: {} })}
                      style={{ marginLeft: "0.5rem" }}
                    >
                      Manage Profiles
                    </Button>
                  </Alert>
                </Card>
              </PageSection>
            )}
            {errorMessage && (
              <PageSection padding={{ default: "noPadding" }}>
                <Card isCompact style={{ maxWidth: "600px", margin: "0 auto" }}>
                  <Alert
                    variant="danger"
                    title="Error"
                    actionClose={
                      <Button variant="link" onClick={() => setErrorMessage(null)}>
                        Close
                      </Button>
                    }
                  >
                    {errorMessage}
                  </Alert>

                  <AlertGroup isToast>
                    <Alert
                      variant="danger"
                      title={errorMessage}
                      // actionClose={<AlertActionCloseButton onClose={() => setErrorMessage(null)} />}
                    />
                  </AlertGroup>
                </Card>
              </PageSection>
            )}
            {configErrors.length > 0 && (
              <PageSection padding={{ default: "noPadding" }}>
                {configErrors.map((error, index) => (
                  <Card
                    isCompact
                    style={{ maxWidth: "600px", marginTop: "1rem", margin: "0 auto" }}
                    key={index}
                  >
                    <Alert variant="warning" title={error.message}>
                      {error.error?.message && error.error.message}
                    </Alert>
                  </Card>
                ))}
              </PageSection>
            )}
            {selectedProfile && (
              <PageSection padding={{ default: "padding" }}>
                <Card isCompact>
                  <CardHeader>
                    <Flex
                      justifyContent={{ default: "justifyContentSpaceBetween" }}
                      alignItems={{ default: "alignItemsCenter" }}
                      style={{ width: "100%" }}
                    >
                      <Flex
                        spaceItems={{ default: "spaceItemsMd" }}
                        alignItems={{ default: "alignItemsCenter" }}
                      >
                        <ExpandableSectionToggle
                          isExpanded={isExpanded}
                          onToggle={(isExpanded) => setIsExpanded(isExpanded)}
                          toggleId="profile-details-toggle"
                        />
                        <ProfileSelector
                          profiles={profiles}
                          activeProfile={activeProfileId}
                          onChange={(id) => dispatch({ type: "SET_ACTIVE_PROFILE", payload: id })}
                          onManageProfiles={() =>
                            dispatch({ type: "OPEN_PROFILE_MANAGER", payload: {} })
                          }
                          isDisabled={isStartingServer || isAnalyzing}
                        />
                      </Flex>
                      <Button
                        variant="primary"
                        onClick={handleRunAnalysis}
                        isLoading={isAnalyzing}
                        isDisabled={
                          isAnalyzing || isStartingServer || !serverRunning || isWaitingForSolution
                        }
                      >
                        {isAnalyzing ? "Analyzing..." : "Run Analysis"}
                      </Button>
                    </Flex>
                  </CardHeader>

                  {isExpanded && (
                    <CardBody>
                      <DescriptionList isCompact columnModifier={{ default: "1Col" }}>
                        <DescriptionListGroup>
                          <DescriptionListTerm>Label Selector</DescriptionListTerm>
                          <DescriptionListDescription>
                            <code>{selectedProfile.labelSelector || "Not set"}</code>
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        {(selectedProfile.customRules?.length ?? 0) > 0 && (
                          <DescriptionListGroup>
                            <DescriptionListTerm>Custom Rules</DescriptionListTerm>
                            <DescriptionListDescription>
                              {selectedProfile.customRules.length} file(s)
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                        )}
                        <DescriptionListGroup>
                          <DescriptionListTerm>Use Default Rules</DescriptionListTerm>
                          <DescriptionListDescription>
                            {selectedProfile.useDefaultRules ? "Yes" : "No"}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      </DescriptionList>
                    </CardBody>
                  )}
                </Card>
              </PageSection>
            )}

            <PageSection>
              <Stack hasGutter>
                <StackItem>
                  <Card>
                    <CardHeader>
                      <Flex className="header-layout">
                        <FlexItem>
                          <CardTitle>Analysis Results</CardTitle>
                          {!isAnalyzing && (
                            <ViolationsCount
                              violationsCount={violations.length}
                              incidentsCount={violations.reduce(
                                (prev, curr) => prev + curr.incidents.length,
                                0,
                              )}
                            />
                          )}
                        </FlexItem>
                      </Flex>
                    </CardHeader>
                    <CardBody>
                      {isAnalyzing && <ProgressIndicator progress={50} />}
                      {!isAnalyzing && !hasViolations && (
                        <EmptyState variant="sm">
                          <Title
                            headingLevel="h2"
                            size="md"
                            className="empty-state-analysis-results"
                          >
                            {hasAnalysisResults ? "No Violations Found" : "No Analysis Results"}
                          </Title>
                          <EmptyStateBody>
                            {hasAnalysisResults
                              ? "Great job! Your analysis didn't find any violations."
                              : "Run an analysis to see results here."}
                          </EmptyStateBody>
                        </EmptyState>
                      )}
                      {hasViolations && !isAnalyzing && (
                        <ViolationIncidentsList
                          enhancedIncidents={enhancedIncidents}
                          focusedIncident={focusedIncident}
                          onIncidentSelect={handleIncidentSelect}
                          expandedViolations={expandedViolations}
                          setExpandedViolations={setExpandedViolations}
                          solutionServerEnabled={solutionServerEnabled}
                        />
                      )}
                    </CardBody>
                  </Card>
                </StackItem>
              </Stack>
            </PageSection>
            {isWaitingForSolution && (
              <Backdrop>
                <div style={{ textAlign: "center", paddingTop: "15rem" }}>
                  <Spinner size="lg" />
                  <Title headingLevel="h2" size="lg">
                    Waiting for solution confirmation...
                  </Title>
                </div>
              </Backdrop>
            )}
          </Page>
        </DrawerContentBody>
      </DrawerContent>
    </Drawer>
  );
};

export default AnalysisPage;
