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
} from "@patternfly/react-core";
import {
  ChatbotHeader,
  ChatbotHeaderActions,
  ChatbotHeaderMain,
  Message,
} from "@patternfly/chatbot";
import { ServerStatusToggle } from "../ServerStatusToggle/ServerStatusToggle";
import { ArrowLeftIcon, ChatIcon } from "@patternfly/react-icons";
import AnalysisPage from "../AnalysisPage/AnalysisPage";
import { useChatState } from "../../hooks/useChatState";

const avatarImg =
  "https://raw.githubusercontent.com/konveyor/tackle2-ui/refs/heads/main/branding/favicon.ico";
const userImg =
  "https://raw.githubusercontent.com/patternfly/patternfly-react/main/packages/react-core/src/components/assets/avatarImg.svg";

function App() {
  const [showAnalysisOverlay, setShowAnalysisOverlay] = useState(false);
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
          <AnalysisPage />
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
              : messages.map((message) => (
                  <Message
                    key={message.id}
                    name={message.name}
                    role={message.role}
                    content={message.content}
                    avatar={message.avatar}
                    timestamp={formatTimestamp(message.timestamp)}
                    disabled={message.disabled}
                    quickResponses={message.quickResponses}
                  />
                ))}
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
