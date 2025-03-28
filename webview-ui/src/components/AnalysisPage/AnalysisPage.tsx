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
  DrawerActions,
  DrawerCloseButton,
  DrawerHead,
  DrawerPanelContent,
} from "@patternfly/react-core";

import ProgressIndicator from "../ProgressIndicator";
import ViolationIncidentsList from "../ViolationIncidentsList";
import { Incident } from "@editor-extensions/shared";
import { openFile, startServer, runAnalysis, stopServer } from "../../hooks/actions";
import { ServerStatusToggle } from "../ServerStatusToggle/ServerStatusToggle";
import { ViolationsCount } from "../ViolationsCount/ViolationsCount";
import { useViolations } from "../..//hooks/useViolations";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";
import CogIcon from "@patternfly/react-icons/dist/esm/icons/cog-icon";
import ConfigOverlay from "../ConfigOverlay/ConfigOverlay";
import { WalkthroughDrawer } from "./WalkthroughDrawer/WalkthroughDrawer";

const AnalysisPage: React.FC = () => {
  const { state, dispatch } = useExtensionStateContext();

  const {
    isAnalyzing,
    isStartingServer,
    isInitializingServer,
    isFetchingSolution: isWaitingForSolution,
    ruleSets: analysisResults,
    enhancedIncidents,
  } = state;
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

  const violations = useViolations(analysisResults);

  const hasViolations = violations.length > 0;
  const hasAnalysisResults = analysisResults !== undefined;

  const drawerRef = React.useRef<HTMLDivElement>(null);

  const walkthroughs = [
    {
      id: "konveyor-setup",
      title: "Set up Konveyor",
      description: "Configure Konveyor for your project",
      steps: [
        {
          id: "override-analyzer",
          title: "Override Analyzer Binary",
          description: "Specify a custom path for the analyzer binary",
          completionEvents: [],
          media: {
            markdown: "media/walkthroughs/override-analyzer.md",
          },
        },
        {
          id: "configure-custom-rules",
          title: "Configure Custom Rules",
          description: "Add custom rules for analysis",
          completionEvents: ["onCommand:konveyor.configureCustomRules"],
          media: {
            markdown: "media/walkthroughs/custom-rules.md",
          },
        },
        {
          id: "configure-analysis-arguments",
          title: "Configure Analysis Arguments",
          description: "Set up analysis arguments such as sources, targets, and label selector",
          completionEvents: [
            "onCommand:konveyor.configureSourcesTargets",
            "onCommand:konveyor.configureLabelSelector",
          ],
          media: {
            markdown: "media/walkthroughs/analysis-arguments.md",
          },
        },
        {
          id: "configure-gen",
          title: "Configure Generative AI",
          description: "Configure Generative AI for your project",
          completionEvents: ["onCommand:konveyor.modelProviderSettingsOpen"],
          media: {
            markdown: "media/walkthroughs/gen-ai.md",
          },
        },
        {
          id: "open-analysis-panel",
          title: "Open Analysis Panel",
          description:
            "Open the Konveyor Analysis Panel to manage and monitor your analysis tasks.",
          completionEvents: [],
          media: {
            markdown: "media/walkthroughs/open-analysis-panel.md",
          },
        },
      ],
    },
  ];

  const panelContent = (
    <WalkthroughDrawer
      isOpen={isConfigOpen}
      onClose={() => setIsConfigOpen(false)}
      drawerRef={drawerRef}
      walkthroughs={walkthroughs}
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
                          />
                        </ToolbarItem>
                        <ToolbarItem>
                          <Button
                            variant="plain"
                            onClick={() => {
                              console.log("clicked config button");
                              setIsConfigOpen(true);
                            }}
                            icon={<CogIcon />}
                          >
                            Configuration
                          </Button>
                        </ToolbarItem>
                      </ToolbarGroup>
                    </ToolbarContent>
                  </Toolbar>
                </MastheadContent>
              </Masthead>
            }
          >
            <ConfigOverlay
              isOpen={isConfigOpen}
              onClose={() => {
                console.log("closing config overlay");
                setIsConfigOpen(false);
              }}
              variant="drawer"
            />

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
