import { Uri } from "vscode";

export interface Task {
  getId(): string;
  getUri(): Uri;
  toString(): string;
  equals(other: Task): boolean;
}

export interface TasksHistory {
  addResolvedTasks(tasks: Task[]): void;
  addUnresolvedTasks(tasks: Task[]): void;
  frequentlyUnresolved(task: Task): boolean;
  getSummary(): string;
}

export interface TaskManager {
  init(): void;
  getTasks(): Task[];
}
