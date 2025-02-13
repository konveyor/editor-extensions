import "./chatPage.css";
import React from "react";
import {
  Page,
  PageSection,
  PageSidebar,
  PageSidebarBody,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
  EmptyState,
  EmptyStateBody,
  Title,
  Spinner,
} from "@patternfly/react-core";
import {
  ChatbotHeader,
  ChatbotHeaderActions,
  ChatbotHeaderMain,
  Message,
} from "@patternfly/chatbot";
import { ChatIcon } from "@patternfly/react-icons";
import { ServerStatusToggle } from "../ServerStatusToggle/ServerStatusToggle";
import { QuickStart } from "@patternfly/chatbot/dist/cjs/Message/QuickStarts/types";

interface ChatPageProps {
  messages: any[];
  chatState: string;
  serverRunning: boolean;
  isStartingServer: boolean;
  isInitializingServer: boolean;
  handleServerToggle: () => void;
  setShowAnalysisOverlay: (show: boolean) => void;
}

export const ChatPage: React.FC<ChatPageProps> = ({
  messages,
  chatState,
  serverRunning,
  isStartingServer,
  isInitializingServer,
  handleServerToggle,
  setShowAnalysisOverlay,
}) => {
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
            {messages.length === 0 || !serverRunning
              ? renderEmptyState()
              : messages.map((message) => {
                  let quickstart = message.quickStart ?? null;
                  let quickstarts = quickstart
                    ? {
                        quickStart: quickstart as QuickStart,
                        onSelectQuickStart: () => setShowAnalysisOverlay(true),
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
                      aria-disabled={message.disabled}
                      quickResponses={message.quickResponses}
                      isLoading={message.loading}
                      quickResponseContainerProps={{
                        isCompact: true,
                        "aria-disabled": true,
                        disabled: true,
                        className: message.disabled ? "disabled" : "",
                      }}
                      // quickStarts={quickstarts}
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
};
