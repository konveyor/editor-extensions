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
  reset(): void;
}

/**
 * A list meant to represent current state of the task manager
 * as well as any additional information about tasks already processed
 * that may be relevant to the user.
 */
export interface TasksList {
  currentTasks: Task[];
  discardedTasks: Task[];
}

export interface TaskManager {
  history: TasksHistory;

  init(): void;
  getTasks(): TasksList;
}
