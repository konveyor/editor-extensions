import { FileChange } from "src/client/types";
import { isUriIgnored } from "../paths";
import * as vscode from "vscode";
import { BackoffManager } from "./backoffManager";
import { ExtensionState } from "src/extensionState";

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
      this.extensionState.mutateData((draft) => {
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
      this.extensionState.mutateData((draft) => {
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
    try {
      const response = await this.extensionState.analyzerClient.runAnalysis(changedFiles);
      console.log("runAnalysis response", response);
      for (const file of changedFiles) {
        this.analysisFileChangesQueue.delete(file);
      }
    } catch (error) {
      console.error("error running analysis", error);
    }
  }

  dispose() {
    this.analysisBackoff.dispose();
    this.notifyFileChangesBackoff.dispose();
  }
}
