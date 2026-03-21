// Agent chat actions (pluggable backend)
export const AGENT_SEND_MESSAGE = "AGENT_SEND_MESSAGE";
export const AGENT_START = "AGENT_START";
export const AGENT_STOP = "AGENT_STOP";
export const AGENT_UPDATE_CONFIG = "AGENT_UPDATE_CONFIG";
export const AGENT_TOGGLE_VIEW = "AGENT_TOGGLE_VIEW";
export const AGENT_INSTALL_CLI = "AGENT_INSTALL_CLI";
export const AGENT_OPEN_SETTINGS = "AGENT_OPEN_SETTINGS";
export const AGENT_PERMISSION_RESPONSE = "AGENT_PERMISSION_RESPONSE";

export type AgentActionType =
  | typeof AGENT_SEND_MESSAGE
  | typeof AGENT_START
  | typeof AGENT_STOP
  | typeof AGENT_UPDATE_CONFIG
  | typeof AGENT_TOGGLE_VIEW
  | typeof AGENT_INSTALL_CLI
  | typeof AGENT_OPEN_SETTINGS
  | typeof AGENT_PERMISSION_RESPONSE;

// Backward-compatible aliases
/** @deprecated Use AGENT_SEND_MESSAGE */
export const GOOSE_SEND_MESSAGE = AGENT_SEND_MESSAGE;
/** @deprecated Use AGENT_START */
export const GOOSE_START_AGENT = AGENT_START;
/** @deprecated Use AGENT_STOP */
export const GOOSE_STOP_AGENT = AGENT_STOP;
/** @deprecated Use AGENT_UPDATE_CONFIG */
export const GOOSE_UPDATE_CONFIG = AGENT_UPDATE_CONFIG;
/** @deprecated Use AGENT_TOGGLE_VIEW */
export const GOOSE_TOGGLE_VIEW = AGENT_TOGGLE_VIEW;
/** @deprecated Use AGENT_INSTALL_CLI */
export const GOOSE_INSTALL_CLI = AGENT_INSTALL_CLI;
/** @deprecated Use AGENT_OPEN_SETTINGS */
export const GOOSE_OPEN_SETTINGS = AGENT_OPEN_SETTINGS;
/** @deprecated Use AGENT_PERMISSION_RESPONSE */
export const GOOSE_PERMISSION_RESPONSE = AGENT_PERMISSION_RESPONSE;
/** @deprecated Use AgentActionType */
export type GooseActionType = AgentActionType;
