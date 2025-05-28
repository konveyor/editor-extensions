import * as vscode from "vscode";
import * as crypto from "crypto";
import { Task, TaskManager, TasksHistory } from "src/taskManager/types";

export class DiagnosticTask implements Task {
  private id: string;
  private uri: vscode.Uri;
  private diagnostic: vscode.Diagnostic;

  constructor(uri: vscode.Uri, diagnostic: vscode.Diagnostic) {
    this.diagnostic = diagnostic;
    this.uri = uri;
    this.id = this.unique_id();
  }

  private unique_id(): string {
    const data = `${this.uri.fsPath}:${this.diagnostic.message}:${this.diagnostic.severity}:${this.diagnostic.source}:${this.diagnostic.code?.toString}`;
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  getId(): string {
    return this.id;
  }

  public equals(other: Task): boolean {
    return other instanceof DiagnosticTask ? other.getId() === this.id : false;
  }

  public getUri(): vscode.Uri {
    return this.uri;
  }

  public toString(): string {
    return `${this.diagnostic.message.split("\n")}`;
  }
}

export class AnalysisDiagnosticTask implements Task {
  private id: string;
  private ruleset: string;
  private violation: string;
  private category: string;
  private message: string;

  constructor(
    private uri: vscode.Uri,
    private diagnostic: vscode.Diagnostic,
  ) {
    this.uri = uri;
    this.diagnostic = diagnostic;
    const { violation, category, ruleset, message } = this.parseFromDiagnostic(diagnostic);
    this.violation = violation;
    this.category = category;
    this.ruleset = ruleset;
    this.message = message;
    this.id = this.unique_id();
  }

  private parseFromDiagnostic(diagnostic: vscode.Diagnostic): {
    ruleset: string;
    violation: string;
    category: string;
    message: string;
  } {
    const parsed = {
      ruleset: "",
      violation: "",
      category: "",
      message: "",
    };
    if (diagnostic.source !== "konveyor") {
      throw new Error(`The diagnostic doesn't seem to come from Konveyor`);
    }
    const lines = diagnostic.message.split("\n");
    parsed.message = lines.length > 0 ? lines[0] : "";
    for (const line of lines) {
      const rulesetMatched = line.match(/- Ruleset: (.*)/);
      const violationMatched = line.match(/- Violation: (.*)/);
      const categoryMatched = line.match(/- Category: (.*)/);
      if (rulesetMatched) {
        parsed.ruleset = rulesetMatched[1].trim();
      }
      if (violationMatched) {
        parsed.violation = violationMatched[1].trim();
      }
      if (categoryMatched) {
        parsed.category = categoryMatched[1].trim();
      }
    }
    if (!parsed.ruleset || !parsed.violation || !parsed.message) {
      throw new Error(`Diagnostic cannot be parsed into an analysis task`);
    }
    return parsed;
  }

  private unique_id(): string {
    const data = `${this.uri.fsPath}:${this.ruleset}:${this.violation}:${this.category}:${this.message}`;
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  getId(): string {
    return this.id;
  }

  getUri(): vscode.Uri {
    return this.uri;
  }

  toString(): string {
    return this.message;
  }

  equals(other: Task): boolean {
    return other instanceof AnalysisDiagnosticTask ? other.getId() === this.id : false;
  }
}

export class DiagnosticTaskHistory implements TasksHistory {
  private unresolvedTasks: Map<string, number>;
  private resolvedTasks: Array<DiagnosticTask | AnalysisDiagnosticTask>;

  constructor() {
    this.unresolvedTasks = new Map<string, number>();
    this.resolvedTasks = [];
  }

  addResolvedTasks(tasks: Array<DiagnosticTask | AnalysisDiagnosticTask>): void {
    this.resolvedTasks.concat(tasks);
    // remove from unresolved too
    tasks.forEach((t) => {
      if (this.unresolvedTasks.has(t.getId())) {
        this.unresolvedTasks.delete(t.getId());
      }
    });
  }

  addUnresolvedTasks(tasks: Array<DiagnosticTask | AnalysisDiagnosticTask>): void {
    tasks.forEach((t) => {
      if (!this.unresolvedTasks.has(t.getId())) {
        this.unresolvedTasks.set(t.getId(), 0);
      }
      this.unresolvedTasks.set(t.getId(), (this.unresolvedTasks.get(t.getId()) ?? 0) + 1);
    });
  }

  frequentlyUnresolved(task: DiagnosticTask | AnalysisDiagnosticTask): boolean {
    return (this.unresolvedTasks.get(task.getId()) ?? 0) > 2;
  }

  getSummary(): string {
    return "";
  }
}

export class DiagnosticTaskManager implements TaskManager {
  private initialized: boolean = false;
  private currentTasks: Array<DiagnosticTask | AnalysisDiagnosticTask>;
  private history: TasksHistory;

  constructor() {
    this.history = new DiagnosticTaskHistory();
    this.currentTasks = this.getCurrentDiagnostics();
  }

  init() {
    if (!this.initialized) {
      const diagnostics = this.getCurrentDiagnostics();
      if (diagnostics.length > 0) {
        this.initialized = true;
        this.currentTasks = diagnostics;
      }
    }
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

  private getCurrentDiagnostics(): Array<DiagnosticTask | AnalysisDiagnosticTask> {
    const diagnostics = vscode.languages.getDiagnostics();

    const filtered = diagnostics.flatMap(([uri, diagnostics]) =>
      diagnostics
        .map((diagnostic) => {
          switch (diagnostic.source ?? "") {
            case "konveyor":
              try {
                return new AnalysisDiagnosticTask(uri, diagnostic);
              } catch {
                return new DiagnosticTask(uri, diagnostic);
              }
            default:
              return new DiagnosticTask(uri, diagnostic);
          }
        })
        .filter(Boolean),
    );

    return filtered;
  }
}
