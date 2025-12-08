// App.tsx
import React, { useState, useEffect } from "react";
import { viewType } from "./utils/vscode";
import AnalysisPage from "./components/AnalysisPage/AnalysisPage";
import ResolutionPage from "./components/ResolutionsPage/ResolutionsPage";
import { WebviewType, ExtensionData } from "@editor-extensions/shared";
import { ProfileManagerPage } from "./components/ProfileManager/ProfileManagerPage";
import { HubSettingsPage } from "./components/HubSettings/HubSettingsPage";
import { getBrandName } from "./utils/branding";
import { useVSCodeMessageHandler } from "./hooks/useVSCodeMessageHandler";
import { useExtensionStore } from "./store/store";

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<WebviewType>(viewType);

  // Initialize Zustand store from window data
  useEffect(() => {
    if (typeof window !== "undefined" && window["konveyorInitialData"]) {
      const windowData = window["konveyorInitialData"] as Partial<ExtensionData>;
      const store = useExtensionStore.getState();

      // Initialize store with window data
      store.batchUpdate({
        ruleSets: Array.isArray(windowData.ruleSets) ? windowData.ruleSets : [],
        enhancedIncidents: Array.isArray(windowData.enhancedIncidents)
          ? windowData.enhancedIncidents
          : [],
        isAnalyzing: windowData.isAnalyzing ?? false,
        isFetchingSolution: windowData.isFetchingSolution ?? false,
        isStartingServer: windowData.isStartingServer ?? false,
        isInitializingServer: windowData.isInitializingServer ?? false,
        isAnalysisScheduled: windowData.isAnalysisScheduled ?? false,
        isContinueInstalled: windowData.isContinueInstalled ?? false,
        serverState: windowData.serverState ?? "initial",
        solutionState: windowData.solutionState ?? "none",
        solutionScope: windowData.solutionScope,
        solutionServerEnabled: windowData.solutionServerEnabled ?? false,
        solutionServerConnected: windowData.solutionServerConnected ?? false,
        isAgentMode: windowData.isAgentMode ?? false,
        workspaceRoot: windowData.workspaceRoot ?? "/",
        activeProfileId: windowData.activeProfileId ?? null,
        isWaitingForUserInteraction: windowData.isWaitingForUserInteraction ?? false,
        isProcessingQueuedMessages: windowData.isProcessingQueuedMessages ?? false,
        activeDecorators: windowData.activeDecorators ?? {},
        profiles: Array.isArray(windowData.profiles) ? windowData.profiles : [],
        configErrors: Array.isArray(windowData.configErrors) ? windowData.configErrors : [],
        chatMessages: Array.isArray(windowData.chatMessages) ? windowData.chatMessages : [],
        pendingBatchReview: Array.isArray(windowData.pendingBatchReview)
          ? windowData.pendingBatchReview
          : [],
        hubConfig: windowData.hubConfig,
        profileSyncEnabled: windowData.profileSyncEnabled ?? false,
        profileSyncConnected: windowData.profileSyncConnected ?? false,
        isSyncingProfiles: windowData.isSyncingProfiles ?? false,
        llmProxyAvailable: windowData.llmProxyAvailable ?? false,
      });
    }
  }, []);

  // Set up VSCode message handler to sync backend state with Zustand store
  useVSCodeMessageHandler();

  useEffect(() => {
    // Set document title based on brand
    document.title = getBrandName();

    // Update the view when viewType changes
    setCurrentView(viewType);
  }, [viewType]);

  return (
    <div>
      {currentView === "sidebar" && <AnalysisPage />}
      {currentView === "resolution" && <ResolutionPage />}
      {currentView === "profiles" && <ProfileManagerPage />}
      {currentView === "hub" && <HubSettingsPage />}
    </div>
  );
};

export default App;
