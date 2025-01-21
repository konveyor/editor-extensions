import { useEffect, useState } from "react";
import { ExtensionData, WebviewAction, WebviewActionType } from "@editor-extensions/shared";
import { sendVscodeMessage as dispatch } from "../utils/vscodeMessaging";

const defaultState: ExtensionData = {
  localChanges: [],
  ruleSets: [],
  resolutionPanelData: undefined,
  isAnalyzing: false,
  isFetchingSolution: false,
  isStartingServer: false,
  solutionData: undefined,
  serverState: "initial",
  solutionScope: undefined,
  workspaceRoot: "/",
};

const windowState =
  typeof window["konveyorInitialData"] === "object"
    ? (window["konveyorInitialData"] as ExtensionData)
    : defaultState;

export function useExtensionState(): [
  ExtensionData,
  (message: WebviewAction<WebviewActionType, unknown>) => void,
] {
  const [state, setState] = useState<ExtensionData>(windowState);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ExtensionData>) => {
      setState(event.data);
    };
    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  });

  return [state, dispatch];
}
