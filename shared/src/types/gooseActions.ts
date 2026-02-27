// Goose chat actions (experimental)
export const GOOSE_SEND_MESSAGE = "GOOSE_SEND_MESSAGE";
export const GOOSE_START_AGENT = "GOOSE_START_AGENT";
export const GOOSE_STOP_AGENT = "GOOSE_STOP_AGENT";
export const GOOSE_UPDATE_CONFIG = "GOOSE_UPDATE_CONFIG";
export const GOOSE_TOGGLE_VIEW = "GOOSE_TOGGLE_VIEW";
export const GOOSE_INSTALL_CLI = "GOOSE_INSTALL_CLI";
export const GOOSE_OPEN_SETTINGS = "GOOSE_OPEN_SETTINGS";

export type GooseActionType =
  | typeof GOOSE_SEND_MESSAGE
  | typeof GOOSE_START_AGENT
  | typeof GOOSE_STOP_AGENT
  | typeof GOOSE_UPDATE_CONFIG
  | typeof GOOSE_TOGGLE_VIEW
  | typeof GOOSE_INSTALL_CLI
  | typeof GOOSE_OPEN_SETTINGS;
