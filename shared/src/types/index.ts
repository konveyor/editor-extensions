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

interface GetSolutionParams {
  file_path: string;
  incidents: Incident[];
}

interface GetSolutionResult {
  encountered_errors: string[]; // An array of error messages
  modified_files: string[]; // An array of modified file paths
  diff: string; // The concatenated diff content
}
