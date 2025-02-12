import "./chatPage.css";
import React, { useState } from "react";
import {
  Page,
  PageSection,
  PageSidebar,
  PageSidebarBody,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
  Spinner,
  Button,
  EmptyState,
  EmptyStateBody,
  Title,
  Alert,
  AlertActionCloseButton,
  AlertGroup,
  Backdrop,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Flex,
  FlexItem,
  Stack,
  StackItem,
} from "@patternfly/react-core";
import {
  ChatbotHeader,
  ChatbotHeaderActions,
  ChatbotHeaderMain,
  Message,
} from "@patternfly/chatbot";
import { ServerStatusToggle } from "../ServerStatusToggle/ServerStatusToggle";
import { ArrowLeftIcon, ChatIcon } from "@patternfly/react-icons";
import { useChatState } from "../../hooks/useChatState";
import { useExtensionState } from "../../hooks/useExtensionState";
import { Incident } from "@editor-extensions/shared";
import { getSolution, openFile } from "../../hooks/actions";
import { useViolations } from "../../hooks/useViolations";
import ProgressIndicator from "../ProgressIndicator";
import ViolationIncidentsList from "../ViolationIncidentsList";
import { ViolationsCount } from "../ViolationsCount/ViolationsCount";
import { QuickStart } from "@patternfly/chatbot/dist/cjs/Message/QuickStarts/types";

const avatarImg =
  "https://raw.githubusercontent.com/konveyor/tackle2-ui/refs/heads/main/branding/favicon.ico";
const userImg =
  "https://raw.githubusercontent.com/patternfly/patternfly-react/main/packages/react-core/src/components/assets/avatarImg.svg";

function App() {
  const [showAnalysisOverlay, setShowAnalysisOverlay] = useState(false);
  const [state, dispatch] = useExtensionState();
  const {
    isAnalyzing,
    isFetchingSolution: isWaitingForSolution,
    ruleSets: analysisResults,
    enhancedIncidents,
    workspaceRoot,
  } = state;
  console.log("state in chat page", state);
  const {
    chatState,
    messages,
    isStartingServer,
    isInitializingServer,
    serverRunning,
    handleServerToggle,
    handleAction,
  } = useChatState({
    avatarImg,
    userImg,
    onShowAnalysis: () => setShowAnalysisOverlay(true),
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [focusedIncident, setFocusedIncident] = useState<Incident | null>(null);
  const [expandedViolations, setExpandedViolations] = useState<Set<string>>(new Set());

  const handleIncidentSelect = (incident: Incident) => {
    setFocusedIncident(incident);
    dispatch(openFile(incident.uri, incident.lineNumber ?? 0));
  };

  const violations = useViolations(analysisResults);

  const hasViolations = violations.length > 0;
  const hasAnalysisResults = analysisResults !== undefined;

  const handleOverlayClose = () => {
    setShowAnalysisOverlay(false);
  };

  const renderEmptyState = () => (
    <EmptyState icon={ChatIcon} variant="xl">
      <Title headingLevel="h2" size="lg">
        Welcome to Konveyor AI (KAI)
      </Title>
      <EmptyStateBody>
        Start the server using the toggle in the top right to begin your analysis session.
      </EmptyStateBody>
    </EmptyState>
  );

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (showAnalysisOverlay) {
    return (
      <div className="analysis-overlay">
        <div className="analysis-header">
          <Button variant="plain" onClick={handleOverlayClose} className="back-button">
            <ArrowLeftIcon />
            <span className="ml-2">Back to Chat</span>
          </Button>
        </div>
        <div className="analysis-content">
          <Page
            sidebar={
              <PageSidebar isSidebarOpen={false}>
                <PageSidebarBody />
              </PageSidebar>
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
                          workspaceRoot={workspaceRoot}
                          isRunning={serverRunning}
                          enhancedIncidents={enhancedIncidents}
                          focusedIncident={focusedIncident}
                          onIncidentSelect={handleIncidentSelect}
                          onGetSolution={(incidents) => dispatch(getSolution(incidents))}
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
        </div>
      </div>
    );
  }

  return (
    <Page
      sidebar={
        <PageSidebar isSidebarOpen={false}>
          <PageSidebarBody />
        </PageSidebar>
      }
    >
      <PageSection className="p-0">
        <div className="chat-container">
          <div className="chat-header">
            <ChatbotHeader>
              <ChatbotHeaderMain>
                <Title headingLevel="h1" size="xl">
                  Konveyor AI
                </Title>
              </ChatbotHeaderMain>
              <ChatbotHeaderActions>
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
                    </ToolbarGroup>
                  </ToolbarContent>
                </Toolbar>
              </ChatbotHeaderActions>
            </ChatbotHeader>
          </div>
          <div className="chat-messages">
            {messages.length === 0
              ? renderEmptyState()
              : messages.map((message) => {
                  let quickstart = message.quickStart ?? null;
                  let quickstarts = quickstart
                    ? {
                        quickStart: quickstart as QuickStart,
                        onSelectQuickStart: () => alert(`Selected quickstart `),
                      }
                    : undefined;
                  return (
                    <Message
                      key={message.id}
                      name={message.name}
                      role={message.role}
                      content={message.content}
                      avatar={message.avatar}
                      timestamp={formatTimestamp(message.timestamp)}
                      disabled={message.disabled}
                      quickResponses={message.quickResponses}
                      quickStarts={quickstarts}
                    />
                  );
                })}
            {chatState === "analyzing" && (
              <div className="flex items-center justify-center p-4">
                <Spinner size="lg" />
              </div>
            )}
          </div>
        </div>
      </PageSection>
    </Page>
  );
}

export default App;
