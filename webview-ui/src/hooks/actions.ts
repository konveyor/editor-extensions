import {
  ExtensionData,
  Incident,
  LocalChange,
  Scope,
  Violation,
  WebviewAction,
  WebviewActionType,
} from "@editor-extensions/shared";

export const setExtensionData = (
  data: ExtensionData,
): WebviewAction<WebviewActionType, ExtensionData> => ({
  type: "SET_STATE",
  payload: data,
});

export const runAnalysis = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "RUN_ANALYSIS",
  payload: {},
});

export const startServer = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "START_SERVER",
  payload: {},
});

export const cancelSolution = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "CANCEL_SOLUTION",
  payload: {},
});

export const getSolution = (
  incident: Incident,
  violation: Violation,
): WebviewAction<WebviewActionType, Scope> => ({
  type: "GET_SOLUTION",
  payload: { incident, violation },
});

export const openFile = (
  file: string,
  line: number,
): WebviewAction<WebviewActionType, { file: string; line: number }> => ({
  type: "OPEN_FILE",
  payload: { file, line },
});

export const viewFix = (change: LocalChange): WebviewAction<WebviewActionType, LocalChange> => ({
  type: "VIEW_FIX",
  payload: change,
});

export const applyFile = (change: LocalChange): WebviewAction<WebviewActionType, LocalChange> => ({
  type: "APPLY_FILE",
  payload: change,
});

export const discardFile = (
  change: LocalChange,
): WebviewAction<WebviewActionType, LocalChange> => ({
  type: "DISCARD_FILE",
  payload: change,
});
