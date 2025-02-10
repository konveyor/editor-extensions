import React from "react";
import {
  Bullseye,
  DropdownGroup,
  DropdownItem,
  DropdownList,
  Page,
  PageSection,
  PageSidebar,
  PageSidebarBody,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from "@patternfly/react-core";
import {
  Chatbot,
  ChatbotContent,
  ChatbotDisplayMode,
  ChatbotHeader,
  ChatbotHeaderActions,
  ChatbotHeaderMain,
  ChatbotHeaderMenu,
  ChatbotHeaderOptionsDropdown,
  ChatbotHeaderSelectorDropdown,
  ChatbotHeaderTitle,
  ChatbotWelcomePrompt,
  Message,
} from "@patternfly/chatbot";
import {
  OutlinedWindowRestoreIcon,
  OpenDrawerRightIcon,
  ExpandIcon,
} from "@patternfly/react-icons";
import QuickResponse from "@patternfly/chatbot/dist/cjs/Message/QuickResponse/QuickResponse";
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
  const [selectedModel, setSelectedModel] = React.useState("Granite Code 7B");
  const [showSelectorDropdown, setShowSelectorDropdown] = React.useState<boolean>(false);
  const [showOptionsDropdown, setShowOptionsDropdown] = React.useState<boolean>(false);

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

  // Add initial welcome message if no messages exist
  React.useEffect(() => {
    if (messages.length === 0) {
      addMessage({
        name: "Kai",
        role: "bot",
        content: "Welcome to Kai Chat! To get started, you'll need to initialize the server.",
        avatar: avatarImg,
      });
    }
  }, []);

  // Add server status messages
  React.useEffect(() => {
    if (isInitializingServer) {
      // addMessage({
      //   name: "Kai",
      //   role: "bot",
      //   content: "Initializing server components...",
      //   avatar: avatarImg,
      // });
    } else if (serverRunning) {
      addMessage({
        name: "Kai",
        role: "bot",
        content: "What can I help you with today?",
        avatar: avatarImg,
      });
    }
  }, [isStartingServer, isInitializingServer, serverRunning]);

  const onSelectModel = (
    _event: React.MouseEvent<Element, MouseEvent> | undefined,
    value: string | number | undefined,
  ) => {
    setSelectedModel(value as string);
  };

  const handleRunAnalysis = () => {
    dispatch(runAnalysis());
    addMessage({
      name: "User",
      role: "user",
      content: "Running analysis...",
      avatar: userImg,
    });
  };

  const analysisQuickResponses: QuickResponse[] = [
    {
      id: "run-analysis",
      content: "Run analysis",
      onClick: handleRunAnalysis,
    },
  ];

  return (
    <Page
      sidebar={
        <PageSidebar isSidebarOpen={false}>
          <PageSidebarBody />
        </PageSidebar>
      }
    >
      <PageSection>
        <Chatbot>
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
              {showSelectorDropdown && (
                <ChatbotHeaderSelectorDropdown value={selectedModel} onSelect={onSelectModel}>
                  <DropdownList>
                    <DropdownItem value="Granite Code 7B" key="granite">
                      Granite Code 7B
                    </DropdownItem>
                    <DropdownItem value="Llama 3.0" key="llama">
                      Llama 3.0
                    </DropdownItem>
                    <DropdownItem value="Mistral 3B" key="mistral">
                      Mistral 3B
                    </DropdownItem>
                  </DropdownList>
                </ChatbotHeaderSelectorDropdown>
              )}
              {showOptionsDropdown && (
                <ChatbotHeaderOptionsDropdown>
                  <DropdownGroup label="Display mode">
                    <DropdownList>
                      <DropdownItem
                        value={ChatbotDisplayMode.default}
                        key="switchDisplayOverlay"
                        icon={<OutlinedWindowRestoreIcon aria-hidden />}
                      >
                        <span>Overlay</span>
                      </DropdownItem>
                      <DropdownItem
                        value={ChatbotDisplayMode.docked}
                        key="switchDisplayDock"
                        icon={<OpenDrawerRightIcon aria-hidden />}
                      >
                        <span>Dock to window</span>
                      </DropdownItem>
                      <DropdownItem
                        value={ChatbotDisplayMode.fullscreen}
                        key="switchDisplayFullscreen"
                        icon={<ExpandIcon aria-hidden />}
                      >
                        <span>Fullscreen</span>
                      </DropdownItem>
                    </DropdownList>
                  </DropdownGroup>
                </ChatbotHeaderOptionsDropdown>
              )}
            </ChatbotHeaderActions>
          </ChatbotHeader>
          <ChatbotContent className="chatbot-content">
            {messages.map((message) => (
              <Message
                key={message.id}
                name={message.name}
                role={message.role}
                content={message.content}
                avatar={message.avatar}
                quickResponses={
                  message.role === "user" && serverRunning ? analysisQuickResponses : undefined
                }
              />
            ))}
          </ChatbotContent>
        </Chatbot>
      </PageSection>
    </Page>
  );
}

export default App;
