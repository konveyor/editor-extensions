/**
 * Stubs for Continue dependencies that aren't needed for static diff functionality
 * These are placeholders to allow compilation without the full Continue infrastructure
 */

// Stub for webview protocol
export class VsCodeWebviewProtocol {
  async request(method: string, params: any): Promise<void> {
    console.log(`Webview protocol request: ${method}`, params);
  }
}

// Stub for edit decoration manager
export class EditDecorationManager {
  clear(): void {
    // No-op
  }
}

// Stub for edit outcome tracker
export const editOutcomeTracker = {
  recordEditOutcome: async (streamId: string, accepted: boolean, _logger: any) => {
    console.log(`Edit outcome: ${streamId} - ${accepted ? "accepted" : "rejected"}`);
  },
  trackEditInteraction: (data: any) => {
    console.log("Edit interaction tracked", data);
  },
};

// Stub for error handling
export async function handleLLMError(error: any): Promise<boolean> {
  console.error("LLM Error:", error);
  return false;
}

// Stub for apply utils
export function isFastApplyModel(_llm: any): boolean {
  return false;
}

// Stub for abort manager
export class ApplyAbortManager {
  private static instance: ApplyAbortManager;

  static getInstance(): ApplyAbortManager {
    if (!this.instance) {
      this.instance = new ApplyAbortManager();
    }
    return this.instance;
  }

  get(_fileUri: string): AbortController {
    return new AbortController();
  }
}

// Stub constants
export const EDIT_MODE_STREAM_ID = "edit-mode-stream";

// Stub for message content utils
export function stripImages(content: string): string {
  return content;
}

// Stub for markdown language detection
export function getMarkdownLanguageTagForFile(filepath: string): string {
  const ext = filepath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "js":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "py":
      return "python";
    case "java":
      return "java";
    case "go":
      return "go";
    case "rs":
      return "rust";
    default:
      return "plaintext";
  }
}

// Stub for token pruning
export function pruneLinesFromTop(text: string, _maxTokens: number, _model: string): string {
  // Simple implementation: just return the text as-is
  return text;
}

export function pruneLinesFromBottom(text: string, _maxTokens: number, _model: string): string {
  // Simple implementation: just return the text as-is
  return text;
}

// Stub for streamDiffLines
export async function* streamDiffLines(_params: any): AsyncGenerator<any> {
  // Empty generator for now
  yield* [];
}
