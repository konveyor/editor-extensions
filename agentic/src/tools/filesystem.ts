import { z } from "zod";
import * as pathlib from "path";
import { promises as fs } from "fs";
import { DynamicStructuredTool } from "@langchain/core/tools";

import { type KaiFsCache, KaiWorkflowMessageType } from "../types";
import { KaiWorkflowEventEmitter } from "../eventEmitter";

function errorToString(err: unknown): string {
  if (err instanceof Error) {
    return err.message || String(err);
  }
  return String(err);
}

/**
 * A collection of managed tools that work with only relative paths
 * This is to make sure we never let a model write outside our tree
 */
export class FileSystemTools extends KaiWorkflowEventEmitter {
  constructor(
    private readonly workspaceDir: string,
    private readonly fsCache: KaiFsCache,
  ) {
    super();
    this.workspaceDir = workspaceDir.replace("file://", "");
    // we never write content to disk because we want the user
    // to review it. All writes go into this cache
    this.fsCache = fsCache;
  }

  public all(): DynamicStructuredTool[] {
    return [
      this.searchFilesTool(this.workspaceDir),
      this.readFileTool(this.workspaceDir),
      this.writeFileTool(this.workspaceDir),
    ];
  }

  private searchFilesTool = (workspaceDir: string): DynamicStructuredTool => {
    return new DynamicStructuredTool({
      name: "searchFiles",
      description: "Returns files matching given filepath pattern",
      schema: z.object({
        pattern: z.string().describe("File name regex pattern to match"),
      }),
      func: async ({ pattern }: { pattern: string }) => {
        const result: string[] = [];
        const rPattern = new RegExp(pattern);
        async function recurse(dir: string) {
          const dirEntries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of dirEntries) {
            const absPath = pathlib.join(dir, entry.name);
            const relPath = pathlib.relative(workspaceDir, absPath);
            if (entry.isDirectory()) {
              await recurse(absPath);
            } else if (
              (entry.isFile() && rPattern.test(entry.name)) ||
              rPattern.test(pathlib.basename(absPath))
            ) {
              result.push(relPath);
            }
          }
        }
        try {
          await recurse(workspaceDir);
          return result.join("\n");
        } catch (err) {
          throw Error(`Failed to search for files - ${errorToString(err)}`);
        }
      },
    });
  };

  private readFileTool = (workspaceDir: string): DynamicStructuredTool => {
    return new DynamicStructuredTool({
      name: "readFile",
      description: "Reads contents of a file",
      schema: z.object({
        path: z.string().describe("Relative path to the file"),
      }),
      func: async ({ path }: { path: string }) => {
        try {
          // check if we recently wrote to this file
          const cachedContent = await this.fsCache.get(path);
          if (cachedContent) {
            return cachedContent;
          }
          const absPath = pathlib.join(workspaceDir, path);
          const stat = await fs.stat(absPath);
          if (!stat.isFile()) {
            return `File at path ${path} does not exist - ensure the path is correct.`;
          }
          const content = await fs.readFile(pathlib.join(workspaceDir, path), "utf-8");
          return content;
        } catch (err) {
          console.error(`Failed to read file ${path}`, err);
          throw Error(`Failed to read file due to error - ${errorToString(err)}`);
        }
      },
    });
  };

  private writeFileTool = (workspaceDir: string): DynamicStructuredTool => {
    return new DynamicStructuredTool({
      name: "writeFile",
      description: "Writes content to a file, creates file and subdirectories if they don't exist",
      schema: z.object({
        path: z.string().describe("Relative path to the file"),
        content: z.string().describe("Content to write"),
      }),
      func: async ({ path, content }: { path: string; content: string }) => {
        try {
          const absPath = pathlib.join(workspaceDir, path);
          const baseDir = pathlib.dirname(absPath);
          await fs.mkdir(baseDir, { recursive: true });
          // only write to cache and send event
          await this.fsCache.set(absPath, content);
          this.emitWorkflowMessage({
            type: KaiWorkflowMessageType.ModifiedFile,
            id: `${absPath}-toolCall`,
            data: {
              content: content,
              path: absPath,
            },
          });
          return "File wrote successfully!";
        } catch (err) {
          console.error(`Failed to write to file ${path}`, err);
          throw Error(`Failed to write content to file due to error - ${errorToString(err)}`);
        }
      },
    });
  };
}
