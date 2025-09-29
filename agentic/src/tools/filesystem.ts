import { z } from "zod";
import * as pathlib from "path";
import { Logger } from "winston";
import { promises as fs } from "fs";
import { DynamicStructuredTool } from "@langchain/core/tools";

import { InMemoryCacheWithRevisions } from "../cache";
import { KaiWorkflowEventEmitter } from "../eventEmitter";
import {
  KaiUserInteractionMessage,
  KaiWorkflowMessageType,
  PendingUserInteraction,
} from "../types";

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
  private logger: Logger;
  private modifiedFilePromises: Map<string, PendingUserInteraction>;

  constructor(
    private readonly workspaceDir: string,
    private readonly fsCache: InMemoryCacheWithRevisions<string, string>,
    logger: Logger,
  ) {
    super();
    this.workspaceDir = workspaceDir.replace("file://", "");
    // we never write content to disk because we want the user
    // to review it. All writes go into this cache
    this.fsCache = fsCache;
    this.logger = logger.child({
      component: "FileSystemTools",
    });
    this.modifiedFilePromises = new Map<string, PendingUserInteraction>();
  }

  public resolveModifiedFilePromise(response: KaiUserInteractionMessage) {
    const promise = this.modifiedFilePromises.get(response.id);
    if (!promise) {
      return;
    }
    const { data } = response;

    // For modifiedFile type, if there's no response field, it means no user interaction
    // was required, so we should resolve as accepted (true)
    if (!data.response) {
      // No user interaction required, treat as accepted
      promise.resolve(response);
      return;
    }

    // If there is a response, validate it has the expected structure
    if (data.response.yesNo === undefined) {
      promise.reject(Error(`Invalid response from user`));
      return;
    }

    promise.resolve(response);
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
        let fixedPattern = pattern.replace(/(?<!\.)(\*)/g, ".*");
        fixedPattern = fixedPattern.replace(/\?/g, ".");
        const rPattern = new RegExp(fixedPattern);
        async function recurse(dir: string) {
          const dirEntries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of dirEntries) {
            const absPath = pathlib.join(dir, entry.name);
            const relPath = pathlib.relative(workspaceDir, absPath);
            if (entry.isDirectory()) {
              await recurse(absPath);
            } else if (
              (entry.isFile() && rPattern.test(entry.name)) ||
              rPattern.test(pathlib.basename(absPath)) ||
              rPattern.test(relPath) ||
              pattern === relPath
            ) {
              result.push(relPath);
            }
          }
        }
        try {
          await recurse(workspaceDir);
          if (result.length === 0) {
            return "There are no files matching this pattern.";
          }
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
          const absPath = pathlib.join(workspaceDir, path);
          // check if we recently wrote to this file
          const cachedContent = await this.fsCache.get(absPath);
          if (cachedContent) {
            return cachedContent;
          }
          const stat = await fs.stat(absPath);
          if (!stat.isFile()) {
            return `File at path ${path} does not exist - ensure the path is correct.`;
          }
          const content = await fs.readFile(pathlib.join(workspaceDir, path), "utf-8");
          return content;
        } catch (err) {
          this.logger.error(`Failed to read file ${path}`, err);
          throw Error(`Failed to read file due to error - ${errorToString(err)}`);
        }
      },
    });
  };

  private writeFileTool = (workspaceDir: string): DynamicStructuredTool => {
    return new DynamicStructuredTool({
      name: "writeFile",
      description:
        "Writes content to a file, creates file and subdirectories if they don't exist. (User may reject the changes you make to the file)",
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
          const accepted = await this.handleModifiedFile(absPath, content);
          if (!accepted) {
            throw new Error("File changes were rejected by the user.");
          }
          return "File wrote successfully!";
        } catch (err) {
          this.logger.error(`Failed to write to file ${path}`, err);
          throw Error(`Failed to write content to file due to error - ${errorToString(err)}`);
        }
      },
    });
  };

  private async handleModifiedFile(path: string, content: string): Promise<boolean> {
    const id = `res-modified-file-${Date.now()}`;
    this.emitWorkflowMessage({
      type: KaiWorkflowMessageType.ModifiedFile,
      id: id,
      data: {
        content: content,
        path: path,
        userInteraction: {
          type: "modifiedFile",
          systemMessage: {
            yesNo: "Accept/reject?",
          },
        },
      },
    });
    // wait for accept / reject
    const promise = new Promise<KaiUserInteractionMessage>((resolve, reject) => {
      this.modifiedFilePromises.set(id, {
        resolve,
        reject,
      });
    });
    try {
      const response = await promise;
      // If there's no response field, it means no user interaction was required
      // so we should treat it as accepted (true)
      if (!response.data.response) {
        return true;
      }
      // If there is a response, check the yesNo value
      if (response.data.response.yesNo) {
        return response.data.response.yesNo;
      }
    } catch {
      return false;
    }
    return false;
  }
}
