import * as vscode from "vscode";
import * as crypto from "crypto";
import { ExtensionState } from "src/extensionState";
import { Task, TaskManager, TasksHistory } from "src/taskManager/types";

export class DiagnosticTask implements Task {
  id: string;
  uri: vscode.Uri;
  diagnostic: vscode.Diagnostic;

  constructor(uri: vscode.Uri, diagnostic: vscode.Diagnostic) {
    this.id = this.unique_id();
    this.uri = uri;
    this.diagnostic = diagnostic;
  }

  private unique_id(): string {
    const data = `${this.uri}:${this.diagnostic.range.start.line}:${this.diagnostic.range.start.character}:
      ${this.diagnostic.range.end.line}:${this.diagnostic.range.end.character}:
      ${this.diagnostic.message}:${this.diagnostic.severity}:${this.diagnostic.source}:
      ${this.diagnostic.code?.toString}`;
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  public equals(other: DiagnosticTask): boolean {
    return this.id === other.id;
  }

  public toString(): string {
    return this.diagnostic.message;
  }
}

export class DiagnosticTaskHistory implements TasksHistory {
  private unresolvedTasks: Map<string, number>;
  private resolvedTasks: DiagnosticTask[];

  constructor() {
    this.unresolvedTasks = new Map<string, number>();
    this.resolvedTasks = [];
  }

  addResolvedTasks(tasks: DiagnosticTask[]): void {
    this.resolvedTasks.concat(tasks);
  }

  addUnresolvedTasks(tasks: DiagnosticTask[]): void {
    tasks.forEach((t) => {
      if (!this.unresolvedTasks.has(t.id)) {
        this.unresolvedTasks.set(t.id, 0);
      }
      this.unresolvedTasks.set(t.id, (this.unresolvedTasks.get(t.id) ?? 0) + 1);
    });
  }

  frequentlyUnresolved(task: DiagnosticTask): boolean {
    return (this.unresolvedTasks.get(task.id) ?? 0) > 2;
  }

  getSummary(): string {
    return "";
  }
}

export class DiagnosticTaskManager implements TaskManager {
  private currentTasks: DiagnosticTask[];
  private history: TasksHistory;

  constructor(private readonly state: ExtensionState) {
    this.state = state;
    this.currentTasks = this.getCurrentDiagnostics();
    this.history = new DiagnosticTaskHistory();
  }

  generateTasks(): Generator<Task, void, void> {
    return (function* (): Generator<Task, void, void> {})();
  }

  getTasks(): Task[] {
    const newDiagnostics = this.getCurrentDiagnostics();
    const resolvedTasks = this.currentTasks.filter(
      (oldTask) => !newDiagnostics.some((newTask) => newTask.equals(oldTask)),
    );
    const newTasks = newDiagnostics.filter(
      (newTask) => !this.currentTasks.some((oldTask) => oldTask.equals(newTask)),
    );
    const unresolvedTasks = newDiagnostics.filter((newTask) =>
      this.currentTasks.some((oldTask) => oldTask.equals(newTask)),
    );
    this.history.addResolvedTasks(resolvedTasks);
    this.history.addUnresolvedTasks(unresolvedTasks);
    this.currentTasks = newDiagnostics;
    return newTasks.filter((t) => !this.history.frequentlyUnresolved(t));
  }

  private getCurrentDiagnostics(): DiagnosticTask[] {
    return vscode.languages
      .getDiagnostics()
      .flatMap(([uri, diagnostics]) =>
        diagnostics.map((diagnostic) => new DiagnosticTask(uri, diagnostic)),
      );
  }
}
