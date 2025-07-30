import React, { createContext, useContext, useEffect, useState, PropsWithChildren } from "react";
import { ExtensionData, WebviewAction, WebviewActionType } from "@editor-extensions/shared";
import { sendVscodeMessage as dispatch } from "../utils/vscodeMessaging";

const defaultState: ExtensionData = {
  localChanges: [],
  ruleSets: [],
  enhancedIncidents: [],
  resolutionPanelData: undefined,
  isAnalyzing: false,
  isFetchingSolution: false,
  isStartingServer: false,
  isInitializingServer: false,
  isAnalysisScheduled: false,
  isContinueInstalled: false,
  solutionData: undefined,
  serverState: "initial",
  solutionScope: undefined,
  workspaceRoot: "/",
  chatMessages: [],
  solutionState: "none",
  solutionEffort: "Low",
  solutionServerEnabled: false,
  configErrors: [],
  profiles: [],
  activeProfileId: "",
  isAgentMode: false,
};

// Safely merge window state with default state to ensure all arrays are defined
const getInitialState = (): ExtensionData => {
  try {
    if (typeof window !== "undefined" && window["konveyorInitialData"]) {
      const windowData = window["konveyorInitialData"] as Partial<ExtensionData>;

      // Ensure all array properties exist and are arrays
      return {
        ...defaultState,
        ...windowData,
        localChanges: Array.isArray(windowData.localChanges) ? windowData.localChanges : [],
        ruleSets: Array.isArray(windowData.ruleSets) ? windowData.ruleSets : [],
        enhancedIncidents: Array.isArray(windowData.enhancedIncidents)
          ? windowData.enhancedIncidents
          : [],
        chatMessages: Array.isArray(windowData.chatMessages) ? windowData.chatMessages : [],
        configErrors: Array.isArray(windowData.configErrors) ? windowData.configErrors : [],
        profiles: Array.isArray(windowData.profiles) ? windowData.profiles : [],
      };
    }
  } catch (error) {
    console.warn("Failed to parse konveyorInitialData, using default state:", error);
  }

  return defaultState;
};

const windowState = getInitialState();

type ExtensionStateContextType = {
  state: ExtensionData;
  dispatch: (message: WebviewAction<WebviewActionType, unknown>) => void;
};

const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined);

export function ExtensionStateProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<ExtensionData>(windowState);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ExtensionData>) => {
      // Ensure incoming data has all required array properties
      const safeData: ExtensionData = {
        ...defaultState,
        ...event.data,
        localChanges: Array.isArray(event.data.localChanges) ? event.data.localChanges : [],
        ruleSets: Array.isArray(event.data.ruleSets) ? event.data.ruleSets : [],
        enhancedIncidents: Array.isArray(event.data.enhancedIncidents)
          ? event.data.enhancedIncidents
          : [],
        chatMessages: Array.isArray(event.data.chatMessages) ? event.data.chatMessages : [],
        configErrors: Array.isArray(event.data.configErrors) ? event.data.configErrors : [],
        profiles: Array.isArray(event.data.profiles) ? event.data.profiles : [],
      };
      setState(safeData);
    };
    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  return (
    <ExtensionStateContext.Provider value={{ state, dispatch }}>
      {children}
    </ExtensionStateContext.Provider>
  );
}

export function useExtensionStateContext(): ExtensionStateContextType {
  const context = useContext(ExtensionStateContext);
  if (context === undefined) {
    throw new Error("useExtensionStateContext must be used within an ExtensionStateProvider");
  }
  return context;
}
