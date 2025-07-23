import "./UnifiedPage.css";
import React, { useState, useMemo } from "react";
import { 
  Page, 
  PageSection, 
  PageSidebar, 
  PageSidebarBody, 
  Title,
  Tabs,
  Tab,
  TabTitleText,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
  Masthead,
  MastheadMain,
  MastheadContent,
  Drawer,
  DrawerContent,
  DrawerContentBody
} from "@patternfly/react-core";
import { SearchIcon, FlaskIcon } from "@patternfly/react-icons";
import AnalysisPage from "../AnalysisPage/AnalysisPage";
import ResolutionPage from "../ResolutionsPage/ResolutionsPage";
import { ServerStatusToggle } from "../ServerStatusToggle/ServerStatusToggle";
import { ConfigButton } from "../AnalysisPage/ConfigButton/ConfigButton";
import { WalkthroughDrawer } from "../AnalysisPage/WalkthroughDrawer/WalkthroughDrawer";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";
import { 
  startServer, 
  stopServer
} from "../../hooks/actions";

const UnifiedPage: React.FC = () => {
  const { state, dispatch } = useExtensionStateContext();
  const [activeTab, setActiveTab] = useState<string>("analysis");
  const [hasAutoSwitched, setHasAutoSwitched] = useState<boolean>(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const drawerRef = React.useRef<HTMLDivElement>(null);

  const {
    serverState,
    isStartingServer,
    isInitializingServer,
    isAnalyzing,
    configErrors,
    profiles,
    activeProfileId
  } = state;

  const serverRunning = serverState === "running";
  
  // Check if there's resolution data to show the resolution tab
  const hasResolutionData = useMemo(() => {
    return (
      state.solutionState !== "none" ||
      (Array.isArray(state.chatMessages) && state.chatMessages.length > 0) ||
      (Array.isArray(state.localChanges) && state.localChanges.length > 0)
    );
  }, [state.solutionState, state.chatMessages, state.localChanges]);

  // Check if resolution is actively processing
  const isResolutionActive = useMemo(() => {
    return state.isFetchingSolution;
  }, [state.isFetchingSolution]);

  // Auto-switch to resolution tab when data becomes available (only once)
  React.useEffect(() => {
    if (hasResolutionData && activeTab === "analysis" && !hasAutoSwitched) {
      setActiveTab("resolution");
      setHasAutoSwitched(true);
    }
    // Reset auto-switch flag when resolution data is cleared
    if (!hasResolutionData) {
      setHasAutoSwitched(false);
    }
  }, [hasResolutionData, activeTab, hasAutoSwitched]);

  const handleTabClick = (event: React.MouseEvent, tabIndex: string | number) => {
    // Allow manual switching to any tab regardless of data state
    setActiveTab(String(tabIndex));
  };

  const handleServerToggle = () => dispatch(serverRunning ? stopServer() : startServer());

  const selectedProfile = profiles.find((p) => p.id === activeProfileId);
  const configInvalid =
    !selectedProfile?.labelSelector?.trim() ||
    (!selectedProfile.useDefaultRules && (selectedProfile.customRules?.length ?? 0) === 0);

  const panelContent = (
    <WalkthroughDrawer
      isOpen={isConfigOpen}
      onClose={() => setIsConfigOpen(false)}
      drawerRef={drawerRef}
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
              <Masthead style={{ position: "sticky", top: 0, zIndex: 1000 }}>
                <MastheadMain>
                  <Title 
                    headingLevel="h1" 
                    size="lg" 
                    style={{ 
                      color: "white",
                      fontSize: "1.2rem",
                      display: "none" // Hide on small screens, show tabs instead
                    }}
                    className="unified-title"
                  >
                    Konveyor AI
                  </Title>
                </MastheadMain>
                <MastheadContent>
                  <Toolbar style={{ padding: "0 0.5rem" }}>
                    <ToolbarContent>
                      <ToolbarGroup style={{ flex: 1, minWidth: 0 }}>
                        <ToolbarItem style={{ flex: 1, minWidth: 0 }}>
                          <Tabs
                            activeKey={activeTab}
                            onSelect={handleTabClick}
                            aria-label="Konveyor AI Assistant tabs"
                            variant="secondary"
                            className="responsive-tabs"
                          >
                            <Tab
                              eventKey="analysis"
                              title={
                                <TabTitleText className="responsive-tab-title">
                                  <SearchIcon className="tab-icon" />
                                  <span className="tab-text">Analysis</span>
                                  {isResolutionActive && activeTab === "analysis" && (
                                    <span 
                                      className="processing-indicator"
                                      title="Resolution processing in background"
                                    >
                                      (Processing...)
                                    </span>
                                  )}
                                </TabTitleText>
                              }
                              aria-label="Analysis tab"
                            />
                            
                            <Tab
                              eventKey="resolution"
                              title={
                                <TabTitleText className="responsive-tab-title">
                                  <FlaskIcon className="tab-icon" />
                                  <span className="tab-text">Resolution</span>
                                  {hasResolutionData && (
                                    <span className="data-indicator" />
                                  )}
                                </TabTitleText>
                              }
                              aria-label="Resolution tab"
                            />
                          </Tabs>
                        </ToolbarItem>
                      </ToolbarGroup>
                      
                      {/* Analysis Controls - only show when on analysis tab */}
                      {activeTab === "analysis" && (
                        <ToolbarGroup className="analysis-controls">
                          <ToolbarItem>
                            <ServerStatusToggle
                              isRunning={serverRunning}
                              isStarting={isStartingServer}
                              isInitializing={isInitializingServer}
                              onToggle={handleServerToggle}
                              hasWarning={configInvalid}
                            />
                          </ToolbarItem>
                          <ToolbarItem className="config-button-item">
                            <ConfigButton
                              onClick={() => setIsConfigOpen(true)}
                              hasWarning={configErrors.length > 0}
                              warningMessage="Please review your configuration before running analysis."
                            />
                          </ToolbarItem>
                        </ToolbarGroup>
                      )}
                    </ToolbarContent>
                  </Toolbar>
                </MastheadContent>
              </Masthead>
            }
          >
            <PageSection style={{ paddingTop: 0 }}>
              {activeTab === "analysis" && (
                <div style={{ marginTop: "1rem" }}>
                  <AnalysisPage hideControls={true} />
                </div>
              )}
              
              {activeTab === "resolution" && (
                <div style={{ marginTop: "1rem" }}>
                  <ResolutionPage hideTitle={true} />
                </div>
              )}
            </PageSection>
          </Page>
        </DrawerContentBody>
      </DrawerContent>
    </Drawer>
  );
};

export default UnifiedPage; 