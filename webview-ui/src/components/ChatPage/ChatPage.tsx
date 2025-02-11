import "./chatPage.css";
import React, { useEffect } from "react";
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
} from "@patternfly/react-core";
import {
  Chatbot,
  ChatbotContent,
  ChatbotHeader,
  ChatbotHeaderActions,
  ChatbotHeaderMain,
  ChatbotHeaderMenu,
  Message,
} from "@patternfly/chatbot";
import { startServer, stopServer, runAnalysis } from "../../hooks/actions";
import { useChatMessages } from "../../hooks/useChatMessages";
import { useExtensionState } from "../../hooks/useExtensionState";
import { ServerStatusToggle } from "../ServerStatusToggle/ServerStatusToggle";

const avatarImg =
  "https://raw.githubusercontent.com/konveyor/tackle2-ui/refs/heads/main/branding/favicon.ico";
const userImg =
  "https://raw.githubusercontent.com/patternfly/patternfly-react/main/packages/react-core/src/components/assets/avatarImg.svg";

function App() {
  const [state, dispatch] = useExtensionState();
  const { isStartingServer, isInitializingServer, serverState } = state;
  const { messages, addMessage, clearMessages } = useChatMessages();
  const serverRunning = serverState === "running";
  const [isLoading, setIsLoading] = React.useState(false);
  const [selectedAction, setSelectedAction] = React.useState<string | null>(null);
  const [lastActionIndex, setLastActionIndex] = React.useState<number>(-1);

  const openAnalysisModal = () => {
    handleActionSelect("View analysis");
  };

  useEffect(() => {
    clearMessages();
    addMessage({
      name: "Kai",
      role: "bot",
      content: "Welcome to Kai Chat! To get started, you'll need to initialize the server.",
      avatar: avatarImg,
    });
  }, []);

  const handleServerToggle = () => {
    if (!serverRunning && !isStartingServer) {
      clearMessages();
      dispatch(startServer());
      addMessage({
        name: "Kai",
        role: "bot",
        content: "Starting the server...",
        avatar: avatarImg,
      });
    } else if (serverRunning) {
      dispatch(stopServer());
      addMessage({
        name: "Kai",
        role: "bot",
        content: "Server has been stopped.",
        avatar: avatarImg,
      });
    }
  };

  const handleActionSelect = async (action: string) => {
    setSelectedAction(action);
    setLastActionIndex(messages.length);
    setIsLoading(true);

    addMessage({
      name: "User",
      role: "user",
      content: action,
      avatar: userImg,
      disabled: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (action === "Run analysis") {
      dispatch(runAnalysis());
      addMessage({
        name: "Kai",
        role: "bot",
        content: "Starting analysis process...",
        avatar: avatarImg,
      });
    } else {
      addMessage({
        name: "Kai",
        role: "bot",
        content: "Opening analysis results...",
        avatar: avatarImg,
      });
    }

    setIsLoading(false);
  };

  useEffect(() => {
    if (serverRunning && !isInitializingServer) {
      addMessage({
        name: "Kai",
        role: "bot",
        content: "What would you like to do?",
        avatar: avatarImg,
        quickResponses: [
          {
            id: "run-analysis",
            content: "Run analysis",
            onClick: () => handleActionSelect("Run analysis"),
          },
          {
            id: "view-analysis",
            content: "View most recent analysis results",
            onClick: () => handleActionSelect("View analysis"),
          },
        ],
      });
    }
  }, [isStartingServer, isInitializingServer, serverRunning]);

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
                <ChatbotHeaderMenu onMenuToggle={() => alert("Menu toggle clicked")} />
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
            {messages.map((message, index) => (
              <Message
                key={message.id}
                name={message.name}
                role={message.role}
                content={message.content}
                avatar={message.avatar}
                disabled={message.disabled || (lastActionIndex >= 0 && index <= lastActionIndex)}
                quickResponses={
                  message.role === "bot" && index > lastActionIndex
                    ? message.quickResponses
                    : undefined
                }
              />
            ))}
            {isLoading && (
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
