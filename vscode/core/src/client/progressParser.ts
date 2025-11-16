/**
 * Progress event parser for kai-analyzer-rpc NDJSON output
 */

export type ProgressEvent = {
  timestamp: string;
  stage:
    | "init"
    | "provider_init"
    | "rule_parsing"
    | "rule_execution"
    | "dependency_analysis"
    | "complete";
  message?: string;
  current?: number;
  total?: number;
  percent?: number;
  metadata?: Record<string, any>;
};

export type ProgressCallback = (event: ProgressEvent) => void;

/**
 * Parses NDJSON progress events from kai-analyzer-rpc stderr
 */
export class ProgressParser {
  private buffer: string = "";
  private callback: ProgressCallback;

  constructor(callback: ProgressCallback) {
    this.callback = callback;
  }

  /**
   * Feed data from stderr to the parser
   */
  feed(data: Buffer | string): void {
    const chunk = typeof data === "string" ? data : data.toString();
    this.buffer += chunk;

    // Process complete lines
    const lines = this.buffer.split("\n");
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        this.parseLine(line);
      }
    }
  }

  private parseLine(line: string): void {
    try {
      const obj = JSON.parse(line);
      if (this.isProgressEvent(obj)) {
        this.callback(obj);
      }
    } catch (err) {
      // Not a JSON line or not a progress event, ignore silently
      // (stderr may contain other logs)
    }
  }

  private isProgressEvent(obj: any): obj is ProgressEvent {
    return (
      typeof obj === "object" &&
      obj !== null &&
      typeof obj.timestamp === "string" &&
      typeof obj.stage === "string" &&
      [
        "init",
        "provider_init",
        "rule_parsing",
        "rule_execution",
        "dependency_analysis",
        "complete",
      ].includes(obj.stage)
    );
  }
}
