import expect from "expect";
import type { ExtensionState } from "../../extensionState";
import type { AnalyzerClient } from "../../client/analyzerClient";
import type { ServerState } from "@editor-extensions/shared";
import { BatchedAnalysisTrigger } from "../batchedAnalysisTrigger";

// Helper to create mock URIs
type VscodeUri = {
  fsPath: string;
  scheme: string;
  path: string;
};

function createMockUri(path: string): VscodeUri {
  return {
    fsPath: path,
    scheme: "file",
    path: path,
  };
}

describe("BatchedAnalysisTrigger - Prerequisites Validation for Issue #1101", () => {
  let consoleWarnings: string[];
  let originalConsoleWarn: typeof console.warn;

  beforeEach(() => {
    consoleWarnings = [];

    originalConsoleWarn = console.warn;
    console.warn = (message: string) => {
      consoleWarnings.push(message);
    };
  });

  afterEach(() => {
    console.warn = originalConsoleWarn;
  });

  function createMockExtensionState(
    serverState: ServerState = "running",
    canAnalyze = true,
    clientInitialized = true,
  ): ExtensionState {
    const data: any = {
      isAnalyzing: false,
      isAnalysisScheduled: false,
    };

    const state = {
      analyzerClient: clientInitialized
        ? ({
            serverState,
            canAnalyze: () => canAnalyze,
          } as unknown as AnalyzerClient)
        : (null as unknown as AnalyzerClient),
      data,
      mutate: (recipe: (draft: any) => void) => {
        recipe(data);
      },
    } as unknown as ExtensionState;

    return state;
  }

  describe("Prerequisites Validation", () => {
    it("should not start analysis when analyzer client is not initialized", async () => {
      const state = createMockExtensionState("running", true, false);
      const trigger = new BatchedAnalysisTrigger(state, false);

      const mockUri = createMockUri("/test/file.ts");
      await trigger.notifyFileChanges({
        path: mockUri as any,
        content: "test content",
        saved: true,
      });

      expect(consoleWarnings).toContain("Analyzer client is not initialized, skipping analysis.");
      expect(state.data.isAnalyzing).toBe(false);
    });

    it("should not start analysis when server is not running", async () => {
      const state = createMockExtensionState("stopped", true, true);
      const trigger = new BatchedAnalysisTrigger(state, false);

      const mockUri = createMockUri("/test/file.ts");
      await trigger.notifyFileChanges({
        path: mockUri as any,
        content: "test content",
        saved: true,
      });

      expect(consoleWarnings).toContain("Analyzer server is not running, skipping analysis.");
      expect(state.data.isAnalyzing).toBe(false);
    });

    it("should not start analysis when analyzer cannot analyze (no profile/rules)", async () => {
      const state = createMockExtensionState("running", false, true);
      const trigger = new BatchedAnalysisTrigger(state, false);

      const mockUri = createMockUri("/test/file.ts");
      await trigger.notifyFileChanges({
        path: mockUri as any,
        content: "test content",
        saved: true,
      });

      expect(consoleWarnings).toContain("Analyzer is not configured properly, skipping analysis.");
      expect(state.data.isAnalyzing).toBe(false);
    });

    it("should not start analysis when server state is starting", async () => {
      const state = createMockExtensionState("starting", true, true);
      const trigger = new BatchedAnalysisTrigger(state, false);

      const mockUri = createMockUri("/test/file.ts");
      await trigger.notifyFileChanges({
        path: mockUri as any,
        content: "test content",
        saved: true,
      });

      expect(consoleWarnings).toContain("Analyzer server is not running, skipping analysis.");
      expect(state.data.isAnalyzing).toBe(false);
    });

    it("should not start analysis when server state is stopping", async () => {
      const state = createMockExtensionState("stopping", true, true);
      const trigger = new BatchedAnalysisTrigger(state, false);

      const mockUri = createMockUri("/test/file.ts");
      await trigger.notifyFileChanges({
        path: mockUri as any,
        content: "test content",
        saved: true,
      });

      expect(consoleWarnings).toContain("Analyzer server is not running, skipping analysis.");
      expect(state.data.isAnalyzing).toBe(false);
    });
  });

  describe("File Queue Management", () => {
    it("should clear file queue when client is not initialized", async () => {
      const state = createMockExtensionState("running", true, false);
      const trigger = new BatchedAnalysisTrigger(state, false);

      const mockUri1 = createMockUri("/test/file1.ts");
      const mockUri2 = createMockUri("/test/file2.ts");

      await trigger.notifyFileChanges({
        path: mockUri1 as any,
        content: "test content 1",
        saved: true,
      });

      await trigger.notifyFileChanges({
        path: mockUri2 as any,
        content: "test content 2",
        saved: true,
      });

      expect((trigger as any).analysisFileChangesQueue.size).toBe(0);
    });

    it("should clear file queue when server is not running", async () => {
      const state = createMockExtensionState("stopped", true, true);
      const trigger = new BatchedAnalysisTrigger(state, false);

      const mockUri = createMockUri("/test/file.ts");
      await trigger.notifyFileChanges({
        path: mockUri as any,
        content: "test content",
        saved: true,
      });

      expect((trigger as any).analysisFileChangesQueue.size).toBe(0);
    });

    it("should clear file queue when analyzer cannot analyze", async () => {
      const state = createMockExtensionState("running", false, true);
      const trigger = new BatchedAnalysisTrigger(state, false);

      const mockUri = createMockUri("/test/file.ts");
      await trigger.notifyFileChanges({
        path: mockUri as any,
        content: "test content",
        saved: true,
      });

      expect((trigger as any).analysisFileChangesQueue.size).toBe(0);
    });
  });

  describe("State Flag Management", () => {
    it("should not set isAnalyzing flag when prerequisites fail - client not initialized", async () => {
      const state = createMockExtensionState("running", true, false);
      const trigger = new BatchedAnalysisTrigger(state, false);

      const mockUri = createMockUri("/test/file.ts");
      await trigger.notifyFileChanges({
        path: mockUri as any,
        content: "test content",
        saved: true,
      });

      expect(state.data.isAnalyzing).toBe(false);
    });

    it("should not leave isAnalyzing flag stuck when server is not running", async () => {
      const state = createMockExtensionState("stopped", true, true);
      const trigger = new BatchedAnalysisTrigger(state, false);

      const mockUri = createMockUri("/test/file.ts");
      await trigger.notifyFileChanges({
        path: mockUri as any,
        content: "test content",
        saved: true,
      });

      expect(state.data.isAnalyzing).toBe(false);
    });

    it("should not leave isAnalyzing flag stuck when canAnalyze returns false", async () => {
      const state = createMockExtensionState("running", false, true);
      const trigger = new BatchedAnalysisTrigger(state, false);

      const mockUri = createMockUri("/test/file.ts");
      await trigger.notifyFileChanges({
        path: mockUri as any,
        content: "test content",
        saved: true,
      });

      expect(state.data.isAnalyzing).toBe(false);
    });
  });

  describe("cancelScheduledAnalysis", () => {
    it("should clear file queues when canceling scheduled analysis", () => {
      const state = createMockExtensionState("running", true, true);
      const trigger = new BatchedAnalysisTrigger(state, true);

      const mockUri = createMockUri("/test/file.ts");
      (trigger as any).analysisFileChangesQueue.add(mockUri);
      (trigger as any).notifyFileChangesQueue.set(mockUri.fsPath, {
        path: mockUri,
        content: "test",
        saved: true,
      });

      trigger.cancelScheduledAnalysis();

      expect((trigger as any).analysisFileChangesQueue.size).toBe(0);
      expect((trigger as any).notifyFileChangesQueue.size).toBe(0);
    });

    it("should reset isAnalysisScheduled flag when canceling", () => {
      const state = createMockExtensionState("running", true, true);
      (state.data as any).isAnalysisScheduled = true;
      const trigger = new BatchedAnalysisTrigger(state, true);

      trigger.cancelScheduledAnalysis();

      expect(state.data.isAnalysisScheduled).toBe(false);
    });
  });
});

describe("BatchedAnalysisTrigger - ignored and unmatchable paths (#1389 review)", () => {
  function stateWithAnalyzer() {
    const data: any = { isAnalyzing: false, isAnalysisScheduled: false };
    return {
      analyzerClient: { serverState: "stopped", canAnalyze: () => true },
      data,
      mutate: (recipe: (draft: any) => void) => recipe(data),
    } as unknown as ExtensionState;
  }
  const uri = (p: string) => ({ fsPath: p, scheme: "file", path: p }) as any;
  let originalWarn: typeof console.warn;
  beforeEach(() => {
    originalWarn = console.warn;
    console.warn = () => {};
  });
  afterEach(() => {
    console.warn = originalWarn;
  });

  it("does not schedule analysis for an ignored save", async () => {
    const state = stateWithAnalyzer();
    const trigger = new BatchedAnalysisTrigger(state, true, () => true);
    await trigger.notifyFileChanges({
      path: uri("/global/provider-settings.yaml"),
      saved: true,
    } as any);
    expect(state.data.isAnalysisScheduled).toBe(false);
    trigger.dispose();
  });

  it("drops a queued path the ignore check cannot handle instead of wedging later flushes", async () => {
    const state = stateWithAnalyzer();
    const fail: { path?: string } = {};
    const isIgnored = (u: any) => {
      if (u.fsPath === fail.path) {
        throw new Error("path should be a `path.relative()`d string");
      }
      return false;
    };
    const trigger = new BatchedAnalysisTrigger(state, false, isIgnored);
    const queue = (trigger as unknown as { analysisFileChangesQueue: Set<unknown> })
      .analysisFileChangesQueue;

    // Enqueued while the check passes, then the matcher starts rejecting it.
    const bad = uri("/outside/../weird");
    queue.add(bad);
    fail.path = bad.fsPath;

    await expect(trigger.runPartialAnalysis()).resolves.toBeUndefined();
    expect(queue.has(bad)).toBe(false);

    // A later workspace save is still processed (server stopped → skipped
    // with a warning, but it gets past the filter instead of throwing).
    await expect(
      trigger.notifyFileChanges({ path: uri("/ws/src/A.java"), saved: true } as any),
    ).resolves.toBeUndefined();
    trigger.dispose();
  });
});
