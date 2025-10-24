import React, { createContext, useContext, useEffect, useState, PropsWithChildren } from "react";
import { ExtensionData, WebviewAction, WebviewActionType } from "@editor-extensions/shared";
import { sendVscodeMessage as dispatch } from "../utils/vscodeMessaging";

const defaultState: ExtensionData = {
  ruleSets: [],
  enhancedIncidents: [],
  isAnalyzing: false,
  isFetchingSolution: false,
  isStartingServer: false,
  isInitializingServer: false,
  isAnalysisScheduled: false,
  isContinueInstalled: false,
  serverState: "initial",
  solutionScope: undefined,
  workspaceRoot: "/",
  chatMessages: [],
  solutionState: "none",
  solutionServerEnabled: false,
  configErrors: [],
  profiles: [],
  activeProfileId: "",
  isAgentMode: false,
  activeDecorators: {},
  solutionServerConnected: false,
  isWaitingForUserInteraction: false,
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
        ruleSets: Array.isArray(windowData.ruleSets) ? windowData.ruleSets : [],
        enhancedIncidents: Array.isArray(windowData.enhancedIncidents)
          ? windowData.enhancedIncidents
          : [],
        chatMessages: Array.isArray(windowData.chatMessages) ? windowData.chatMessages : [],
        configErrors: Array.isArray(windowData.configErrors) ? windowData.configErrors : [],
        profiles: Array.isArray(windowData.profiles) ? windowData.profiles : [],
        activeDecorators: windowData.activeDecorators || {},
        isWaitingForUserInteraction: windowData.isWaitingForUserInteraction || false,
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
    const handleMessage = (event: MessageEvent<ExtensionData | { type: string; chatMessages: any[]; timestamp: string }>) => {
      // Handle selective chat message updates
      if ('type' in event.data && event.data.type === 'CHAT_MESSAGES_UPDATE') {
        setState(prevState => ({
          ...prevState,
          chatMessages: Array.isArray(event.data.chatMessages) ? event.data.chatMessages : prevState.chatMessages,
        }));
        return;
      }

      // Handle full state updates (for non-chat changes)
      const data = event.data as ExtensionData;
      const safeData: ExtensionData = {
        ...defaultState,
        ...data,
        ruleSets: Array.isArray(data.ruleSets) ? data.ruleSets : [],
        enhancedIncidents: Array.isArray(data.enhancedIncidents)
          ? data.enhancedIncidents
          : [],
        chatMessages: Array.isArray(data.chatMessages) ? data.chatMessages : [],
        configErrors: Array.isArray(data.configErrors) ? data.configErrors : [],
        profiles: Array.isArray(data.profiles) ? data.profiles : [],
        activeDecorators: data.activeDecorators || {},
        isWaitingForUserInteraction: data.isWaitingForUserInteraction || false,
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
