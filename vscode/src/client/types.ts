import { Incident } from "../webview/types";

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

interface GetSolutionParams {
  file_path: string;
  incidents: Incident[];
}

interface GetSolutionResult {
  encountered_errors: string[]; // An array of error messages
  modified_files: string[]; // An array of modified file paths
  diff: string; // The concatenated diff content
}
