import expect from "expect";
import winston from "winston";
import { createBridgeRunAnalysis, type BridgeAnalyzer } from "../bridgeAnalysis";

const silentLogger = winston.createLogger({ silent: true, transports: [] });

class FakeAnalyzer implements BridgeAnalyzer {
  serverState = "running";
  interactive = true;
  runs = 0;
  starts = 0;
  /** State the analyzer ends up in after start() is called. */
  stateAfterStart = "running";

  async canAnalyzeInteractive(): Promise<boolean> {
    return this.interactive;
  }

  async start(): Promise<void> {
    this.starts++;
    this.serverState = this.stateAfterStart;
  }

  async runAnalysis(): Promise<void> {
    this.runs++;
  }
}

function build(
  analyzer: FakeAnalyzer | undefined,
  storeState: { enhancedIncidents?: unknown[]; ruleSets?: unknown[] } = {},
) {
  const sent: Record<string, unknown>[] = [];
  const run = createBridgeRunAnalysis({
    getAnalyzer: () => analyzer,
    getStoreState: () => storeState,
    sendToWebviews: (m) => sent.push(m),
    logger: silentLogger,
    pollIntervalMs: 1,
    startupTimeoutMs: 50,
  });
  return { run, sent };
}

describe("createBridgeRunAnalysis", () => {
  it("rejects when no analyzer client is available", async () => {
    const { run } = build(undefined);
    await expect(run()).rejects.toThrow("Analyzer is not available");
  });

  it("rejects when the analyzer cannot run interactively", async () => {
    const analyzer = new FakeAnalyzer();
    analyzer.serverState = "stopped";
    analyzer.interactive = false;
    const { run } = build(analyzer);
    await expect(run()).rejects.toThrow(/not configured/);
    expect(analyzer.starts).toBe(0);
    expect(analyzer.runs).toBe(0);
  });

  for (const terminal of ["startFailed", "stopped"]) {
    it(`rejects when startup ends in ${terminal}`, async () => {
      const analyzer = new FakeAnalyzer();
      analyzer.serverState = "stopped";
      analyzer.stateAfterStart = terminal;
      const { run } = build(analyzer);
      await expect(run()).rejects.toThrow(`Analyzer failed to start (state: ${terminal})`);
      expect(analyzer.starts).toBe(1);
      expect(analyzer.runs).toBe(0);
    });
  }

  it("rejects when the analyzer never reaches running before the timeout", async () => {
    const analyzer = new FakeAnalyzer();
    analyzer.serverState = "stopped";
    analyzer.stateAfterStart = "starting";
    const { run } = build(analyzer);
    await expect(run()).rejects.toThrow("Analyzer failed to start (state: starting)");
    expect(analyzer.runs).toBe(0);
  });

  it("starts a stopped analyzer, runs analysis and posts a summary", async () => {
    const analyzer = new FakeAnalyzer();
    analyzer.serverState = "stopped";
    const { run, sent } = build(analyzer, {
      enhancedIncidents: [{}, {}],
      ruleSets: [{}],
    });
    await run();
    expect(analyzer.starts).toBe(1);
    expect(analyzer.runs).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      type: "AGENT_CHAT_STREAMING_UPDATE",
      content: "Analysis complete: 2 incidents found across 1 rule set.",
      done: false,
    });
    expect(sent[1]).toMatchObject({ messageId: sent[0].messageId, done: true });
  });

  it("runs analysis without a summary when no incidents are found", async () => {
    const analyzer = new FakeAnalyzer();
    const { run, sent } = build(analyzer, { enhancedIncidents: [] });
    await run();
    expect(analyzer.runs).toBe(1);
    expect(sent).toEqual([]);
  });

  it("propagates analysis failures", async () => {
    const analyzer = new FakeAnalyzer();
    analyzer.runAnalysis = async () => {
      throw new Error("analyzer exploded");
    };
    const { run } = build(analyzer);
    await expect(run()).rejects.toThrow("analyzer exploded");
  });
});
