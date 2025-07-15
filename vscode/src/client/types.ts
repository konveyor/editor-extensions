import * as vscode from "vscode";

export type SupportedModelProviders =
  | "AzureChatOpenAI"
  | "ChatBedrock"
  | "ChatDeepSeek"
  | "ChatGoogleGenerativeAI"
  | "ChatOllama"
  | "ChatOpenAI";

export interface KaiModelConfig {
  provider: SupportedModelProviders;
  args: Record<string, any>;
  template?: string;
  llamaHeader?: boolean;
  llmRetries?: number;
  llmRetryDelay?: number;
}

export interface FileChange {
  path: vscode.Uri;
  content: string;
  saved: boolean;
}
