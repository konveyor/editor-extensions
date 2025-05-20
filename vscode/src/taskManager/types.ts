import { Uri } from "vscode";

export interface Task {
  getUri(): Uri;
  equals(other: Task): boolean;
  toString(): string;
}

export interface TasksHistory {
  addResolvedTasks(tasks: Task[]): void;
  addUnresolvedTasks(tasks: Task[]): void;
  frequentlyUnresolved(task: Task): boolean;
  getSummary(): string;
}

export interface TaskManager {
  generateTasks(): Generator<Task, void, void>;
  getTasks(): Task[];
}
