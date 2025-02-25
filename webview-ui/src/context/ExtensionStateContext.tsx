import React, { createContext, useContext, PropsWithChildren } from "react";
import { ExtensionData, WebviewAction, WebviewActionType } from "@editor-extensions/shared";
import { useExtensionState } from "../hooks/useExtensionState";

type ExtensionStateContextType = {
  state: ExtensionData;
  dispatch: (message: WebviewAction<WebviewActionType, unknown>) => void;
};

const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined);

export function ExtensionStateProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useExtensionState();

  return (
    <ExtensionStateContext.Provider value={{ state, dispatch }}>
      {children}
    </ExtensionStateContext.Provider>
  );
}

export function useExtensionStateContext() {
  const context = useContext(ExtensionStateContext);
  if (context === undefined) {
    throw new Error("useExtensionStateContext must be used within an ExtensionStateProvider");
  }
  return context;
}
