export type ServerLogLevels = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL";

export interface ServerCliArguments {
  /** The initial log level for the server. Default: INFO */
  logLevel?: ServerLogLevels;

  /** The initial stderr log level for the server. Default: TRACE */
  stderrLogLevel?: ServerLogLevels;

  /** The initial file log level for the server. Default: DEBUG */
  fileLogLevel?: ServerLogLevels;

  /** The directory path for log files. Default: "./logs" */
  logDirPath?: string;

  /** The name of the log file. Default: "./kai-rpc-server.log" */
  logFileName?: string;
}

/**
 * Logging configurations on initialization. These match {@link ServerCliArguments} currently
 * but have slightly different uses.
 */
export interface KaiLogConfig {
  logLevel?: ServerLogLevels; // defaults to "INFO"
  stderrLogLevel?: ServerLogLevels; // defaults to "TRACE"
  fileLogLevel?: ServerLogLevels; // defaults to "DEBUG"
  logDirPath?: string; // defaults to "./logs"
  logFileName?: string; // defaults to "./kai_server.log"
}

export interface KaiConfigModels {
  provider: string;
  args: Record<string, any>;
  template?: string;
  llamaHeader?: boolean;
  llmRetries?: number;
  llmRetryDelay?: number;
}

/**
 * `initialize` request content as camel case (camelCase and snake_case are both accepted)
 *
 * {@link https://github.com/konveyor/kai/blob/78f31fa609a5b53bf66f334803afa72f3849a7e2/kai/rpc_server/server.py#L61}
 */
export interface KaiRpcApplicationConfig {
  processId?: number;

  rootPath: string;
  modelProvider: KaiConfigModels;

  logConfig: KaiLogConfig;

  demoMode?: boolean; // defaults to `false`
  cacheDir?: string; // defaults to `None`
  enableReflection?: boolean; // defaults to `true`

  analyzerLspLspPath: string;
  analyzerLspRpcPath: string;
  analyzerLspRulesPaths: string[];
  analyzerLspJavaBundlePaths: string[];
  analyzerLspDepLabelsPath?: string; // defaults to `None`
  analyzerLspExcludedPaths: string[];

  // TODO: Do we need to include `fernFlowerPath` to support the java decompiler?
  // analyzerLspFernFlowerPath?: string;
}
