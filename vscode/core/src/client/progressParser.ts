/**
 * Progress event parser for kai-analyzer-rpc NDJSON output
 */

/**
 * Valid progress stages for analysis events
 */
export const VALID_PROGRESS_STAGES = [
  "init",
  "provider_init",
  "provider_prepare",
  "rule_parsing",
  "rule_execution",
  "dependency_analysis",
  "complete",
] as const;

export type ProgressStage = (typeof VALID_PROGRESS_STAGES)[number];

export type ProgressEvent = {
  timestamp: string;
  stage: ProgressStage;
  message?: string;
  current?: number;
  total?: number;
  percent?: number;
  metadata?: Record<string, any>;
};

/**
 * Callback function invoked when a valid progress event is parsed
 */
export type ProgressCallback = (event: ProgressEvent) => void;

/**
 * Callback function invoked for non-JSON stderr lines (typically error messages)
 * that should be logged separately from progress events
 */
export type NonProgressLineCallback = (line: string) => void;

/**
 * Parses NDJSON progress events from kai-analyzer-rpc stderr
 *
 * The parser processes stderr output and:
 * - Extracts valid progress events and passes them to the progress callback
 * - Filters out non-progress JSON to prevent output clutter
 * - Forwards non-JSON lines (actual error messages) to the optional logging callback
 */
export class ProgressParser {
  private buffer: string = "";
  private callback: ProgressCallback;
  private nonProgressLineCallback?: NonProgressLineCallback;

  /**
   * Creates a new ProgressParser
   *
   * @param callback - Function to call when a valid progress event is parsed
   * @param nonProgressLineCallback - Optional function to call for non-JSON stderr lines (error messages)
   */
  constructor(callback: ProgressCallback, nonProgressLineCallback?: NonProgressLineCallback) {
    this.callback = callback;
    this.nonProgressLineCallback = nonProgressLineCallback;
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

  /**
   * Parses a single line from stderr
   *
   * The line is processed as follows:
   * 1. If it's valid JSON and a progress event → invoke progress callback
   * 2. If it's valid JSON but not a progress event → skip (prevents garbled output)
   * 3. If it's not valid JSON → invoke non-progress callback (actual error message)
   *
   * @param line - A single line from stderr to parse
   */
  private parseLine(line: string): void {
    try {
      const obj = JSON.parse(line);
      if (this.isProgressEvent(obj)) {
        this.callback(obj);
      }
      // Skip other JSON - don't log it to prevent clutter in OUTPUT panel
    } catch {
      // Not valid JSON - this is likely an actual error message, so log it
      if (this.nonProgressLineCallback) {
        this.nonProgressLineCallback(line);
      }
    }
  }

  private isProgressEvent(obj: any): obj is ProgressEvent {
    return (
      typeof obj === "object" &&
      obj !== null &&
      typeof obj.timestamp === "string" &&
      typeof obj.stage === "string" &&
      VALID_PROGRESS_STAGES.includes(obj.stage as ProgressStage)
    );
  }
}
