import { basename } from "path";
import { TasksList } from "./types";

/**
 * Summarizes the tasks into a string to be displayed to the user.
 * @param tasks - The tasks to summarize.
 */
export function summarizeTasks(tasks: TasksList): string {
  const uriToTasksMap = new Map<string, string[]>();

  tasks.currentTasks.forEach((task) => {
    const uri = task.getUri();
    if (!uriToTasksMap.has(uri.fsPath)) {
      uriToTasksMap.set(uri.fsPath, []);
    }
    uriToTasksMap.get(uri.fsPath)?.push(task.toString());
  });

  let summary = "### New issues:\n";
  uriToTasksMap.forEach((taskList, uri) => {
    summary += `- ${taskList.length} new issues in **${basename(uri)}**.\n`;
    const uniqueTasks = Array.from(new Set(taskList));
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

  return summary;
}

/**
 * Flattens the tasks into a list of { uri, task } objects as expected by the agent.
 * @param tasks - The tasks to flatten.
 */
export function flattenCurrentTasks(tasks: TasksList): { uri: string; task: string }[] {
  return tasks.currentTasks.map((t) => ({ uri: t.getUri().fsPath, task: t.toString() }));
}
