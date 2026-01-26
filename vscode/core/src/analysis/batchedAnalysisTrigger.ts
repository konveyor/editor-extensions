import { FileChange } from "../client/types";
import { isUriIgnored } from "../paths";
import * as vscode from "vscode";
import { BackoffManager } from "./backoffManager";
import { ExtensionState } from "../extensionState";
import { runPartialAnalysis } from "./runAnalysis";

export class BatchedAnalysisTrigger {
  private analysisBackoff: BackoffManager;
  private notifyFileChangesBackoff: BackoffManager;
  private notifyFileChangesQueue: Map<string, FileChange> = new Map();
  private analysisFileChangesQueue: Set<vscode.Uri> = new Set();

  constructor(
    private readonly extensionState: ExtensionState,
    private readonly enableHotRerun: boolean = true,
  ) {
    this.analysisBackoff = new BackoffManager(3000, 30000, 10000);
    this.notifyFileChangesBackoff = new BackoffManager(1000, 10000, 10000);
    this.extensionState = extensionState;
    this.enableHotRerun = enableHotRerun;
  }

  async notifyFileChanges(change: FileChange) {
    if (this.enableHotRerun) {
      this.extensionState.mutateAnalysisState((draft) => {
        draft.isAnalysisScheduled = true;
      });
      // hot re-run if enabled
      this.notifyFileChangesQueue.set(change.path.fsPath, change);
      this.scheduleNotifyFileChanges();
      this.analysisFileChangesQueue.add(change.path);
      this.schedulePartialAnalysis();
    } else if (change.saved) {
      // when a file is saved, we still want to call analysis
      this.analysisFileChangesQueue.add(change.path);
      this.runPartialAnalysis();
    }
  }

  private scheduleNotifyFileChanges() {
    this.notifyFileChangesBackoff.schedule(async () => {
      if (this.extensionState.data.isAnalyzing || this.analysisBackoff.isRunningCallback()) {
        // if there is an analysis in progress,
        // postpone notifying file changes
        this.notifyFileChangesBackoff.increaseBackoff();
        this.scheduleNotifyFileChanges();
        return;
      }
      const changes = Array.from(this.notifyFileChangesQueue.values()).filter(
        (change) => !isUriIgnored(change.path),
      );
      if (changes.length < 1) {
        // no changes to notify
        return;
      }
      try {
        await this.extensionState.analyzerClient.notifyFileChanges(changes);
        for (const change of changes) {
          this.notifyFileChangesQueue.delete(change.path.fsPath);
        }
      } catch (error) {
        console.error("error notifying file changes", error);
      }
    });
  }

  private schedulePartialAnalysis() {
    this.analysisBackoff.schedule(async () => {
      if (
        this.extensionState.data.isAnalyzing ||
        this.notifyFileChangesBackoff.isRunningCallback()
      ) {
        // if there is an analysis or notifyFileChanges
        // in progress, postpone the partialAnalysis
        this.analysisBackoff.increaseBackoff();
        this.schedulePartialAnalysis();
        return;
      }
      await this.runPartialAnalysis();
      this.extensionState.mutateAnalysisState((draft) => {
        draft.isAnalysisScheduled = false;
      });
    });
  }

  public async runPartialAnalysis() {
    const changedFiles = Array.from(this.analysisFileChangesQueue).filter(
      (uri) => !isUriIgnored(uri),
    );
    if (changedFiles.length < 1) {
      // no changes to analyze
      return;
    }

    const analyzerClient = this.extensionState.analyzerClient;
    if (!analyzerClient) {
      console.warn("Analyzer client is not initialized, skipping analysis.");
      this.analysisFileChangesQueue.clear();
      return;
    }

    if (analyzerClient.serverState !== "running") {
      console.warn("Analyzer server is not running, skipping analysis.");
      this.analysisFileChangesQueue.clear();
      return;
    }

    if (!analyzerClient.canAnalyze()) {
      console.warn("Analyzer is not configured properly, skipping analysis.");
      this.analysisFileChangesQueue.clear();
      return;
    }

    // Set isAnalyzing immediately to prevent button from being enabled
    this.extensionState.mutateAnalysisState((draft) => {
      draft.isAnalyzing = true;
      draft.isAnalysisScheduled = false;
    });

    try {
      await runPartialAnalysis(this.extensionState, changedFiles);
      for (const file of changedFiles) {
        this.analysisFileChangesQueue.delete(file);
      }
    } catch (error) {
      console.error("error running analysis", error);
      // Reset isAnalyzing on error since analyzerClient won't do it
      this.extensionState.mutateAnalysisState((draft) => {
        draft.isAnalyzing = false;
      });
    }
  }

  public cancelScheduledAnalysis() {
    // Cancel any scheduled analysis
    this.analysisBackoff.cancel();

    // Clear the queues
    this.analysisFileChangesQueue.clear();
    this.notifyFileChangesQueue.clear();

    // Reset the scheduled flag
    if (this.extensionState.data.isAnalysisScheduled) {
      this.extensionState.mutateAnalysisState((draft) => {
        draft.isAnalysisScheduled = false;
      });
    }
  }

  public isScheduledAnalysisRunning(): boolean {
    return this.analysisBackoff.isRunningCallback();
  }

  dispose() {
    this.analysisBackoff.dispose();
    this.notifyFileChangesBackoff.dispose();
  }
}
