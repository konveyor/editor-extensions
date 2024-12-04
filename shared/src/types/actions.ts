export const SET_STATE = "SET_STATE";
export const RUN_ANALYSIS = "RUN_ANALYSIS";
export const START_SERVER = "START_SERVER";
export const CANCEL_SOLUTION = "CANCEL_SOLUTION";
export const GET_SOLUTION = "GET_SOLUTION";
export const OPEN_FILE = "OPEN_FILE";
export const VIEW_FIX = "VIEW_FIX";
export const APPLY_FILE = "APPLY_FILE";
export const DISCARD_FILE = "DISCARD_FILE";
export const WEBVIEW_READY = "WEBVIEW_READY";

export type WebviewActionType =
  | typeof SET_STATE
  | typeof RUN_ANALYSIS
  | typeof START_SERVER
  | typeof CANCEL_SOLUTION
  | typeof GET_SOLUTION
  | typeof OPEN_FILE
  | typeof VIEW_FIX
  | typeof APPLY_FILE
  | typeof DISCARD_FILE
  | typeof WEBVIEW_READY;

export interface WebviewAction<S, T> {
  type: S;
  payload: T;
}
