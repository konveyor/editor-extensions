import { basename } from "path";
import { TasksList } from "./types";
import { DiagnosticIssue, DiagnosticSummary } from "@editor-extensions/shared";

/**
 * Summarizes the tasks into structured data for interactive display.
 * @param tasks - The tasks to summarize.
 */
export function summarizeTasksStructured(tasks: TasksList): DiagnosticSummary {
  const uriToTasksMap = new Map<string, string[]>();
  const issuesByFile: Record<string, DiagnosticIssue[]> = {};

  tasks.currentTasks.forEach((task) => {
    const uri = task.getUri();
    if (!uriToTasksMap.has(uri.fsPath)) {
      uriToTasksMap.set(uri.fsPath, []);
    }
    uriToTasksMap.get(uri.fsPath)?.push(task.toString());
  });

  let summary = "### New issues:\n";
  uriToTasksMap.forEach((taskList, uri) => {
    const filename = basename(uri);
    summary += `- ${taskList.length} new issues in **${filename}**.\n`;

    // Create structured issues for this file
    const uniqueTasks = Array.from(new Set(taskList));
    const fileIssues: DiagnosticIssue[] = uniqueTasks.map((task) => ({
      id: `${uri}-${task}`,
      message: task.length > 200 ? task.slice(0, 197) + "..." : task,
      uri,
      filename,
    }));

    issuesByFile[filename] = fileIssues;

    // Show first 2 issues in summary
    uniqueTasks.slice(0, Math.min(2, uniqueTasks.length)).forEach((task) => {
      summary += `  - ${task.length > 200 ? task.slice(0, 197) + "..." : task}\n`;
    });
    if (taskList.length > 2) {
      summary += `   ...and *${taskList.length - Math.min(2, uniqueTasks.length)} more*\n`;
    }
  });

  if (tasks.discardedTasks.length > 0) {
    summary +=
      "### The following issues were identified but have been discarded due to unsuccessful resolution attempts in the previous iterations:\n";
    tasks.discardedTasks.forEach((task) => {
      const strippedTask = task.toString().replace(/[`*_{}[\]()#+\-.!]/g, "");
      summary += `- ${strippedTask.length > 200 ? strippedTask.slice(0, 197) + "..." : strippedTask}\n`;
    });
  }

  return {
    summary,
    issuesByFile,
    totalIssues: tasks.currentTasks.length,
  };
}

/**
 * Summarizes the tasks into a string to be displayed to the user.
 * @param tasks - The tasks to summarize.
 */
export function summarizeTasks(tasks: TasksList): string {
  return summarizeTasksStructured(tasks).summary;
}

/**
 * Flattens the tasks into a list of { uri, task } objects as expected by the agent.
 * @param tasks - The tasks to flatten.
 */
export function flattenCurrentTasks(tasks: TasksList): { uri: string; task: string }[] {
  return tasks.currentTasks.map((t) => ({ uri: t.getUri().fsPath, task: t.toString() }));
}
