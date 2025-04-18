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
  solutionData: undefined,
  serverState: "initial",
  solutionScope: undefined,
  workspaceRoot: "/",
  chatMessages: [],
  solutionState: "none",
  solutionEffort: "Low",
  analysisConfig: {
    labelSelectorValid: false,
    genAIConfigured: false,
    genAIKeyMissing: false,
    genAIUsingDefault: false,
    customRulesConfigured: false,
  },
  profiles: [],
  activeProfileId: "",
};

const windowState =
  typeof window["konveyorInitialData"] === "object"
    ? (window["konveyorInitialData"] as ExtensionData)
    : defaultState;

type ExtensionStateContextType = {
  state: ExtensionData;
  dispatch: (message: WebviewAction<WebviewActionType, unknown>) => void;
};

const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined);

export function ExtensionStateProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<ExtensionData>(windowState);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ExtensionData>) => {
      setState(event.data);
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
