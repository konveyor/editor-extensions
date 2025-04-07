import "./styles.css";
import React, { useState } from "react";
import {
  Button,
  ButtonVariant,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  EmptyStateBody,
  Title,
  Alert,
  AlertActionCloseButton,
  AlertGroup,
  Spinner,
  Backdrop,
  Page,
  PageSection,
  Stack,
  StackItem,
  Flex,
  FlexItem,
  PageSidebar,
  PageSidebarBody,
  Masthead,
  MastheadMain,
  MastheadToggle,
  MastheadContent,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
  Drawer,
  DrawerContent,
  DrawerContentBody,
} from "@patternfly/react-core";

import ProgressIndicator from "../ProgressIndicator";
import ViolationIncidentsList from "../ViolationIncidentsList";
<<<<<<< HEAD
import { AnalysisConfig, Incident } from "@editor-extensions/shared";
=======
import { AnalysisProfile, Incident } from "@editor-extensions/shared";
>>>>>>> 9842302 (Initial changes for profile creation setting)
import { openFile, startServer, runAnalysis, stopServer } from "../../hooks/actions";
import { ServerStatusToggle } from "../ServerStatusToggle/ServerStatusToggle";
import { ViolationsCount } from "../ViolationsCount/ViolationsCount";
import { useViolations } from "../..//hooks/useViolations";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";
<<<<<<< HEAD
import { WalkthroughDrawer } from "./WalkthroughDrawer/WalkthroughDrawer";
import { ConfigButton } from "./ConfigButton/ConfigButton";
=======
import { ProfileSelector } from "../ProfileSelector/ProfileSelector";
import { NewProfileModal } from "../NewProfileModal/NewProfileModal";
>>>>>>> 9842302 (Initial changes for profile creation setting)

const AnalysisPage: React.FC = () => {
  const { state, dispatch } = useExtensionStateContext();

  const {
    isAnalyzing,
    isStartingServer,
    isInitializingServer,
    isFetchingSolution: isWaitingForSolution,
    ruleSets: analysisResults,
    enhancedIncidents,
<<<<<<< HEAD
    analysisConfig,
=======
    profiles: initialProfiles,
    activeProfileName: initialActiveProfile,
>>>>>>> 9842302 (Initial changes for profile creation setting)
  } = state;

  const [profiles, setProfiles] = useState(initialProfiles);
  const [activeProfile, setActiveProfile] = useState(initialActiveProfile);
  const [showProfileModal, setShowProfileModal] = useState(false);

  const serverRunning = state.serverState === "running";

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [focusedIncident, setFocusedIncident] = useState<Incident | null>(null);
  const [expandedViolations, setExpandedViolations] = useState<Set<string>>(new Set());
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  const handleIncidentSelect = (incident: Incident) => {
    setFocusedIncident(incident);
    dispatch(openFile(incident.uri, incident.lineNumber ?? 0));
  };

  const runAnalysisRequest = () => dispatch(runAnalysis());

  const handleServerToggle = () => {
    dispatch(serverRunning ? stopServer() : startServer());
  };

  const handleProfileChange = (newProfile: string) => {
    setActiveProfile(newProfile);
    dispatch({
      type: "SET_ACTIVE_PROFILE",
      payload: newProfile,
    });
  };

  const handleSaveProfile = (newProfile: AnalysisProfile) => {
    // Add to extension state
    // dispatch({ type: "ADD_PROFILE", payload: newProfile });

    // Send to backend for persistence
    window.vscode.postMessage({
      type: "ADD_PROFILE",
      payload: newProfile,
    });

    // Activate it
    // dispatch({ type: "UPDATE_ACTIVE_PROFILE", payload: newProfile.name });
  };

  const violations = useViolations(analysisResults);

  const hasViolations = violations.length > 0;
  const hasAnalysisResults = analysisResults !== undefined;

  const drawerRef = React.useRef<HTMLDivElement>(null);

  const panelContent = (
    <WalkthroughDrawer
      isOpen={isConfigOpen}
      onClose={() => setIsConfigOpen(false)}
      drawerRef={drawerRef}
      analysisConfig={analysisConfig}
    />
  );

  function getConfigWarning(config: AnalysisConfig): string | null {
    if (!config.labelSelectorValid) {
      return "Label selector is not configured. Please configure sources, targets, or a label selector.";
    }
    if (config.genAIKeyMissing) {
      return "GenAI API key is missing. Please set your key in settings.";
    }
    if (config.genAIUsingDefault && !config.genAIConfigured) {
      return "Using default GenAI settings. Consider updating them for best results.";
    }
    return null;
  }

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
                      onClick={runAnalysisRequest}
                      isLoading={isAnalyzing}
                      isDisabled={
                        isAnalyzing || isStartingServer || !serverRunning || isWaitingForSolution
                      }
                    >
                      {isAnalyzing ? "Analyzing..." : "Run Analysis"}
                    </Button>
                  </MastheadToggle>
                </MastheadMain>

<<<<<<< HEAD
                <MastheadContent>
                  <Toolbar>
                    <ToolbarContent>
                      <ToolbarGroup variant="action-group-plain" align={{ default: "alignEnd" }}>
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
                    actionClose={
                      <AlertActionCloseButton
                        title={errorMessage}
                        onClose={() => setErrorMessage(null)}
                      />
                    }
                  />
                </AlertGroup>
              </PageSection>
            )}
=======
          <MastheadContent>
            <Toolbar>
              <ToolbarContent>
                <ToolbarGroup variant="action-group-plain" align={{ default: "alignEnd" }}>
                  <ToolbarItem>
                    <ProfileSelector
                      profiles={profiles ?? []}
                      activeProfile={activeProfile ?? ""}
                      onChange={handleProfileChange}
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
              actionClose={
                <AlertActionCloseButton
                  title={errorMessage}
                  onClose={() => setErrorMessage(null)}
                />
              }
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
                        (prev, curr) => curr.incidents.length + prev,
                        0,
                      )}
                    />
                  </FlexItem>
                  <>
                    <FlexItem></FlexItem>
                  </>
                </Flex>
              </CardHeader>
              <CardBody>
                {isAnalyzing && <ProgressIndicator progress={50} />}

                {!isAnalyzing && !hasViolations && (
                  <EmptyState variant="sm">
                    <Title className="empty-state-analysis-results" headingLevel="h2" size="md">
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
      <NewProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        onSave={(profile) => {
          // dispatch({ type: "ADD_PROFILE", payload: profile });
          // window.vscode.postMessage({ type: "ADD_PROFILE", payload: profile });
        }}
      />
>>>>>>> 9842302 (Initial changes for profile creation setting)

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
                              (prev, curr) => curr.incidents.length + prev,
                              0,
                            )}
                          />
                        </FlexItem>
                        <>
                          <FlexItem></FlexItem>
                        </>
                      </Flex>
                    </CardHeader>
                    <CardBody>
                      {isAnalyzing && <ProgressIndicator progress={50} />}

                      {!isAnalyzing && !hasViolations && (
                        <EmptyState variant="sm">
                          <Title
                            className="empty-state-analysis-results"
                            headingLevel="h2"
                            size="md"
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
