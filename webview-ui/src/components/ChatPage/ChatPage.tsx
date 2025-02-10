import "./chatPage.css";
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
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from "@patternfly/react-core";
import { useExtensionState } from "../../hooks/useExtensionState";
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
import { ServerStatusToggle } from "../ServerStatusToggle/ServerStatusToggle";
import { startServer, stopServer } from "../../hooks/actions";
import ActionLabels from "./ActionLabels";
const avatarImg =
  "https://raw.githubusercontent.com/konveyor/tackle2-ui/refs/heads/main/branding/favicon.ico";
const ChatPage: React.FC = () => {
  const [state, dispatch] = useExtensionState();
  const {
    isFetchingSolution,
    solutionScope,
    solutionMessages,
    solutionState,
    isStartingServer,
    isInitializingServer,
    serverState,
  } = state;

  const serverRunning = serverState === "running";
  const isTriggeredByUser = !!solutionScope?.incidents?.length;
  const [selectedModel, setSelectedModel] = React.useState("Granite Code 7B");
  const [showAll, setShowAll] = React.useState<boolean>(true);
  const [showMenu, setShowMenu] = React.useState<boolean>(true);
  const [showLogo, setShowLogo] = React.useState<boolean>(false);
  const [showCenteredLogo, setShowCenteredLogo] = React.useState<boolean>(true);
  const [showSelectorDropdown, setShowSelectorDropdown] = React.useState<boolean>(false);
  const [showOptionsDropdown, setShowOptionsDropdown] = React.useState<boolean>(false);
  const [showWelcomePrompts, setShowWelcomePrompts] = React.useState<boolean>(true);

  const handleServerToggle = () => {
    dispatch(serverRunning ? stopServer() : startServer());
  };

  const onSelectModel = (
    _event: React.MouseEvent<Element, MouseEvent> | undefined,
    value: string | number | undefined,
  ) => {
    setSelectedModel(value as string);
  };

  const welcomePrompts = [
    {
      title: "Start Server",
      message: "Would you like to start the server to begin our conversation?",
      onClick: () => {
        if (!serverRunning && !isStartingServer) {
          dispatch(startServer());
        }
      },
    },
  ];

  const getLoadingMessage = () => {
    if (isStartingServer) {
      return "Starting the server...";
    }
    if (isInitializingServer) {
      return "Initializing server components...";
    }
    return "Preparing the environment...";
  };

  const title = "Kai Chat";
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
            {(showMenu || showLogo || showCenteredLogo) && (
              <ChatbotHeaderMain>
                {showMenu && (
                  <ChatbotHeaderMenu onMenuToggle={() => alert("Menu toggle clicked")} />
                )}
                {/* {(showLogo || showCenteredLogo) && (
                  <ChatbotHeaderTitle>
                    {showCenteredLogo ? <Bullseye>{title}</Bullseye> : title}
                  </ChatbotHeaderTitle>
                )} */}
              </ChatbotHeaderMain>
            )}
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
            {!serverRunning && !isStartingServer && !isInitializingServer && (
              <ChatbotWelcomePrompt
                title="Welcome to Kai Chat"
                description="To get started, you'll need to initialize the server."
                prompts={welcomePrompts}
                className="chatbot-welcome-prompt"
              />
            )}
            {(isStartingServer || isInitializingServer) && (
              <Message
                name="Kai"
                role="bot"
                isLoading
                content="Kai is preparing the environment..."
                avatar={avatarImg}
              />
            )}
            {serverRunning && (
              <Message
                name="Kai"
                role="bot"
                content="What can I help you with today?"
                avatar={avatarImg}
              />
            )}
            <ActionLabels serverRunning={serverRunning} />
          </ChatbotContent>
        </Chatbot>
      </PageSection>
    </Page>
  );
};

export default ChatPage;
