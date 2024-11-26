import { Uri } from "vscode";

export interface Incident {
  uri: string;
  lineNumber: number;
  severity: "High" | "Medium" | "Low";
  message: string;
  codeSnip: string;
}

export interface Link {
  url: string;
  title?: string;
}

export enum Category {
  Potential = "potential",
  Optional = "optional",
  Mandatory = "mandatory",
}

export interface Violation {
  description: string;
  category?: Category;
  labels?: string[];
  incidents: Incident[];
  links?: Link[];
  extras?: unknown;
  effort?: number;
}

export interface RuleSet {
  name?: string;
  description?: string;
  tags?: string[];
  violations?: { [key: string]: Violation };
  insights?: { [key: string]: Violation };
  errors?: { [key: string]: string };
  unmatched?: string[];
  skipped?: string[];
}

// KaiConfigModels type definition
export interface KaiConfigModels {
  provider: string;
  args: Record<string, any>;
  template?: string;
  llamaHeader?: boolean;
  llmRetries: number;
  llmRetryDelay: number;
}

// KaiRpcApplicationConfig type definition
export interface KaiInitializeParams {
  rootPath: string;
  modelProvider: KaiConfigModels;
  kaiBackendUrl: string;

  logLevel: string;
  stderrLogLevel: string;
  fileLogLevel?: string;
  logDirPath?: string;

  analyzerLspLspPath: string;
  analyzerLspRpcPath: string;
  analyzerLspRulesPath: string;
  analyzerLspJavaBundlePath: string;
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
  errors: string[];
  changes: Change[];
}

export interface LocalChange {
  modifiedUri: Uri;
  originalUri: Uri;
  diff: string;
  state: "pending" | "applied" | "discarded";
}

export interface ResolutionMessage {
  type: string;
  solution: GetSolutionResult;
  violation: Violation;
  incident: Incident;
  isRelevantSolution: boolean;
}

export interface SolutionResponse {
  diff: string;
  encountered_errors: string[];
  modified_files: string[];
  incident: Incident;
  violation: Violation;
}
