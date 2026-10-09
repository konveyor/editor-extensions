import { AgentMessageTypes } from "@editor-extensions/shared";
import type winston from "winston";

/** The subset of AnalyzerClient the bridge needs. */
export interface BridgeAnalyzer {
  readonly serverState: string;
  canAnalyzeInteractive(): Promise<boolean>;
  start(): Promise<void>;
  runAnalysis(): Promise<void>;
}

export interface BridgeAnalysisDeps {
  getAnalyzer(): BridgeAnalyzer | undefined;
  getStoreState(): {
    enhancedIncidents?: ReadonlyArray<unknown>;
    ruleSets?: ReadonlyArray<unknown>;
  };
  sendToWebviews(message: Record<string, unknown>): void;
  logger: winston.Logger;
  /** How often to poll the analyzer state while it starts up. */
  pollIntervalMs?: number;
  /** Give up waiting for the analyzer to start after this long. */
  startupTimeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;

/**
 * Build the `runAnalysis` callback for the MCP bridge's /api/run-analysis
 * route. The bridge answers HTTP 200 with an `analysis_complete` summary of
 * whatever is in the store once this resolves, so every path that does not
 * end in a fresh, awaited analysis run must throw — otherwise the agent is
 * told stale results are the outcome of a run that never happened.
 */
export function createBridgeRunAnalysis(deps: BridgeAnalysisDeps): () => Promise<void> {
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const startupTimeoutMs = deps.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;

  return async () => {
    const analyzer = deps.getAnalyzer();
    if (!analyzer) {
      deps.logger.warn("MCP run_analysis: analyzerClient not available");
      throw new Error("Analyzer is not available");
    }

    if (analyzer.serverState !== "running") {
      if (!(await analyzer.canAnalyzeInteractive())) {
        throw new Error("Analyzer is not configured; fix the active analysis profile first");
      }
      await analyzer.start();
      await waitForAnalyzerStart(analyzer, pollIntervalMs, startupTimeoutMs);
    }

    if (analyzer.serverState !== "running") {
      deps.logger.warn(`MCP run_analysis: analyzer not running (state: ${analyzer.serverState})`);
      throw new Error(`Analyzer failed to start (state: ${analyzer.serverState})`);
    }

    await analyzer.runAnalysis();

    const storeData = deps.getStoreState();
    const incidentCount = storeData.enhancedIncidents?.length ?? 0;
    const ruleSetCount = storeData.ruleSets?.length ?? 0;
    if (incidentCount === 0) {
      return;
    }

    const sysId = `system-analysis-${Date.now()}`;
    const summary = `Analysis complete: ${incidentCount} incident${incidentCount !== 1 ? "s" : ""} found across ${ruleSetCount} rule set${ruleSetCount !== 1 ? "s" : ""}.`;
    const timestamp = new Date().toISOString();
    deps.sendToWebviews({
      type: AgentMessageTypes.AGENT_CHAT_STREAMING_UPDATE,
      messageId: sysId,
      content: summary,
      done: false,
      timestamp,
    });
    deps.sendToWebviews({
      type: AgentMessageTypes.AGENT_CHAT_STREAMING_UPDATE,
      messageId: sysId,
      content: "",
      done: true,
      timestamp,
    });
  };
}

function waitForAnalyzerStart(
  analyzer: BridgeAnalyzer,
  pollIntervalMs: number,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = setInterval(() => {
      const state = analyzer.serverState;
      if (
        state === "running" ||
        state === "startFailed" ||
        state === "stopped" ||
        Date.now() >= deadline
      ) {
        clearInterval(check);
        resolve();
      }
    }, pollIntervalMs);
  });
}
