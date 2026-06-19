import * as fs from "fs";
import { Logger } from "winston";

/**
 * Incrementally tails the analyzer log file during startup and surfaces
 * ERROR/FATAL-level lines to the extension's output channel via the logger.
 *
 * Uses polling with incremental reads so it works reliably on all platforms
 * (fs.watch is unreliable on network filesystems and some Windows setups).
 */
export class AnalyzerLogTailer {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastSize = 0;
  private buffer = "";

  private static readonly ERROR_PATTERNS: ReadonlyArray<RegExp> = [
    /"level"\s*:\s*"error"/i,
    /"level"\s*:\s*"fatal"/i,
    /\blevel=error\b/i,
    /\blevel=fatal\b/i,
  ];

  constructor(
    private readonly logFilePath: string,
    private readonly logger: Logger,
    private readonly pollIntervalMs = 1000,
  ) {}

  start(): void {
    if (this.intervalHandle) {
      return;
    }

    this.lastSize = this.getCurrentFileSize();
    this.buffer = "";
    this.intervalHandle = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private getCurrentFileSize(): number {
    try {
      return fs.statSync(this.logFilePath).size;
    } catch {
      return 0;
    }
  }

  private poll(): void {
    const currentSize = this.getCurrentFileSize();
    if (currentSize <= this.lastSize) {
      return;
    }

    let fd: number;
    try {
      fd = fs.openSync(this.logFilePath, "r");
    } catch {
      return;
    }

    try {
      const bytesToRead = currentSize - this.lastSize;
      const buf = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buf, 0, bytesToRead, this.lastSize);
      this.lastSize = currentSize;
      this.processChunk(buf.toString("utf-8"));
    } finally {
      fs.closeSync(fd);
    }
  }

  private processChunk(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && this.isErrorLine(trimmed)) {
        this.logger.error(`[analyzer.log] ${trimmed}`);
      }
    }
  }

  private isErrorLine(line: string): boolean {
    return AnalyzerLogTailer.ERROR_PATTERNS.some((pattern) => pattern.test(line));
  }
}
