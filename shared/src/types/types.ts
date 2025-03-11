import { Uri } from "vscode";
import { SolutionEffortLevel } from "../effort";

export type WebviewType = "sidebar" | "resolution";

export interface Incident {
  uri: string;
  lineNumber?: number;
  message: string;
  codeSnip?: string;
}

export interface Link {
  url: string;
  title?: string;
}

export type Category = "potential" | "optional" | "mandatory";

export interface Violation {
  description: string;
  category?: Category;
  labels?: string[];
  incidents: Incident[];
  effort?: number;
}

export type EnhancedViolation = Violation & {
  id: string;
  rulesetName?: string;
  violationName?: string;
};
// Keep EnhancedIncident type aligned with KAI backend type:
// https://github.com/konveyor/kai/blob/82e195916be14eddd08c4e2bfb69afc0880edfcb/kai/analyzer_types.py#L89-L106
export interface EnhancedIncident extends Incident {
  violationId: string;
  uri: string;
  message: string;
  ruleset_name?: string;
  ruleset_description?: string;
  violation_name?: string;
  violation_description?: string;
  violation_category?: Category;
  violation_labels?: string[];
}

export interface RuleSet {
  name?: string;
  description?: string;
  tags?: string[];
  violations?: { [key: string]: EnhancedViolation };
  insights?: { [key: string]: EnhancedViolation };
  errors?: { [key: string]: string };
  unmatched?: string[];
  skipped?: string[];
}

export interface GetSolutionParams {
  file_path: string;
  incidents: Incident[];
}
export interface Change {
  // relative file path before the change, may be empty if file was created in this change
  original: string;
  // relative file path after the change, may be empty if file was deleted in this change
  modified: string;
  // diff in unified format - tested with git diffs
  diff: string;
}

export interface GetSolutionResult {
  encountered_errors: string[];
  changes: Change[];
  scope: Scope;
}

export interface LocalChange {
  modifiedUri: Uri;
  originalUri: Uri;
  diff: string;
  state: "pending" | "applied" | "discarded";
}

export interface ResolutionMessage {
  type: string;
  solution: Solution;
  violation: Violation;
  incident: Incident;
  isRelevantSolution: boolean;
}

export interface SolutionResponse {
  diff: string;
  encountered_errors: string[];
  modified_files: string[];
}

export interface Scope {
  incidents: EnhancedIncident[];
  effort: SolutionEffortLevel;
}

export type Solution = GetSolutionResult | SolutionResponse;

export enum ChatMessageType {
  String = "SimpleChatMessage",
  Markdown = "MarkdownChatMessage",
  JSON = "JsonChatMessage",
}

export interface ChatMessage {
  kind: ChatMessageType;
  value: { message: string } | Record<string, unknown>;
  chatToken?: string;
  messageToken: string;
  timestamp: string;
  extraContent?: React.ReactNode;
}

export interface ExtensionData {
  workspaceRoot: string;
  localChanges: LocalChange[];
  ruleSets: RuleSet[];
  enhancedIncidents: EnhancedIncident[];
  resolutionPanelData: any;
  isAnalyzing: boolean;
  isFetchingSolution: boolean;
  isStartingServer: boolean;
  isInitializingServer: boolean;
  serverState: ServerState;
  solutionState: SolutionState;
  solutionData?: Solution;
  solutionScope?: Scope;
  chatMessages: ChatMessage[];
  solutionEffort: SolutionEffortLevel;
}

export type ServerState =
  | "initial"
  | "configurationNeeded"
  | "configurationReady"
  | "starting"
  | "readyToInitialize"
  | "initializing"
  | "startFailed"
  | "running"
  | "stopping"
  | "stopped";

export type SolutionState =
  | "none"
  | "started"
  | "sent"
  | "received"
  | "failedOnStart"
  | "failedOnSending";
