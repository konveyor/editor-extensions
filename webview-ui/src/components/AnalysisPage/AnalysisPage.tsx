import "./styles.css";
import React, { useState } from "react";
import {
  Alert,
  AlertActionCloseButton,
  AlertGroup,
  Backdrop,
  Button,
  ButtonVariant,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Drawer,
  DrawerContent,
  DrawerContentBody,
  EmptyState,
  EmptyStateBody,
  Flex,
  FlexItem,
  Masthead,
  MastheadContent,
  MastheadMain,
  MastheadToggle,
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

import { openFile, startServer, runAnalysis, stopServer } from "../../hooks/actions";
import { useViolations } from "../../hooks/useViolations";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";
import { WalkthroughDrawer } from "./WalkthroughDrawer/WalkthroughDrawer";
import { ConfigButton } from "./ConfigButton/ConfigButton";
import { ServerStatusToggle } from "../ServerStatusToggle/ServerStatusToggle";
import { ViolationsCount } from "../ViolationsCount/ViolationsCount";
import ViolationIncidentsList from "../ViolationIncidentsList";
import { ProfileSelector } from "../ProfileSelector/ProfileSelector";
import ProgressIndicator from "../ProgressIndicator";
import { Incident, AnalysisConfig } from "@editor-extensions/shared";

const AnalysisPage: React.FC = () => {
  const { state, dispatch } = useExtensionStateContext();

  const {
    isAnalyzing,
    isStartingServer,
    isInitializingServer,
    isFetchingSolution: isWaitingForSolution,
    ruleSets: analysisResults,
    enhancedIncidents,
    analysisConfig,
    profiles,
    activeProfileName,
    serverState,
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

  const handleIncidentSelect = (incident: Incident) => {
    setFocusedIncident(incident);
    dispatch(openFile(incident.uri, incident.lineNumber ?? 0));
  };

  const handleRunAnalysis = () => dispatch(runAnalysis());
  const handleServerToggle = () => dispatch(serverRunning ? stopServer() : startServer());

  const getConfigWarning = (config: AnalysisConfig): string | null => {
    if (!config.labelSelectorValid) return "Label selector is not configured.";
    if (config.genAIKeyMissing) return "GenAI API key is missing.";
    if (config.genAIUsingDefault && !config.genAIConfigured) {
      return "Using default GenAI settings.";
    }
    return null;
  };

  const panelContent = (
    <WalkthroughDrawer
      isOpen={isConfigOpen}
      onClose={() => setIsConfigOpen(false)}
      drawerRef={drawerRef}
      analysisConfig={analysisConfig}
    />
  );

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
                <MastheadMain>
                  <MastheadToggle>
                    <Button
                      variant={ButtonVariant.primary}
                      onClick={handleRunAnalysis}
                      isLoading={isAnalyzing}
                      isDisabled={
                        isAnalyzing || isStartingServer || !serverRunning || isWaitingForSolution
                      }
                    >
                      {isAnalyzing ? "Analyzing..." : "Run Analysis"}
                    </Button>
                  </MastheadToggle>
                </MastheadMain>
                <MastheadContent>
                  <Toolbar>
                    <ToolbarContent>
                      <ToolbarGroup variant="action-group-plain" align={{ default: "alignEnd" }}>
                        <ToolbarItem>
                          <ProfileSelector
                            profiles={profiles}
                            activeProfile={activeProfileName}
                            onChange={(name) =>
                              dispatch({ type: "SET_ACTIVE_PROFILE", payload: name })
                            }
                          />
                        </ToolbarItem>
                        <ToolbarItem>
                          <Button
                            variant="secondary"
                            onClick={() => dispatch({ type: "OPEN_PROFILE_MANAGER", payload: {} })}
                          >
                            Manage Profiles
                          </Button>
                        </ToolbarItem>
                        <ToolbarItem>
                          <ServerStatusToggle
                            isRunning={serverRunning}
                            isStarting={isStartingServer}
                            isInitializing={isInitializingServer}
                            onToggle={handleServerToggle}
                            hasWarning={!analysisConfig.labelSelectorValid}
                          />
                        </ToolbarItem>
                        <ToolbarItem>
                          <ConfigButton
                            onClick={() => setIsConfigOpen(true)}
                            hasWarning={!analysisConfig.labelSelectorValid}
                            warningMessage={getConfigWarning(analysisConfig)}
                          />
                        </ToolbarItem>
                      </ToolbarGroup>
                    </ToolbarContent>
                  </Toolbar>
                </MastheadContent>
              </Masthead>
            }
          >
            {errorMessage && (
              <PageSection padding={{ default: "noPadding" }}>
                <AlertGroup isToast>
                  <Alert
                    variant="danger"
                    title={errorMessage}
                    actionClose={<AlertActionCloseButton onClose={() => setErrorMessage(null)} />}
                  />
                </AlertGroup>
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
                          <ViolationsCount
                            violationsCount={violations.length}
                            incidentsCount={violations.reduce(
                              (prev, curr) => prev + curr.incidents.length,
                              0,
                            )}
                          />
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
