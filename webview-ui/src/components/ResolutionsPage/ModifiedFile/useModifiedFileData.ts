import { useMemo } from "react";
import { ModifiedFileMessageValue } from "@editor-extensions/shared";

/**
 * Normalized data for read-only ModifiedFile display
 * Simplified for batch review architecture - no status or action tracking needed
 */
export interface NormalizedFileData {
  path: string;
  isNew: boolean;
  isDeleted: boolean;
  diff: string;
  content: string;
  messageToken: string;
  originalContent: string;
  fileName: string;
}

export const useModifiedFileData = (
  data: ModifiedFileMessageValue,
  workspaceRoot?: string,
): NormalizedFileData => {
  return useMemo(() => {
    const normalizedPath = data.path.replace(/\\/g, "/");
    let fileName: string;

    if (workspaceRoot) {
      let root = workspaceRoot.replace(/\\/g, "/");
      if (root.startsWith("file:///")) {
        root = root.slice("file://".length);
      } else if (root.startsWith("file:")) {
        root = root.slice("file:".length);
      }
      root = root.replace(/\/$/, "");

      fileName = normalizedPath.startsWith(root)
        ? normalizedPath.slice(root.length + 1) || normalizedPath.split("/").pop() || "Unnamed File"
        : normalizedPath.split("/").pop() || data.path || "Unnamed File";
    } else {
      fileName = normalizedPath.split("/").pop() || data.path || "Unnamed File";
    }

    return {
      path: data.path,
      isNew: data.isNew,
      isDeleted: data.isDeleted || false,
      diff: data.diff,
      content: data.content,
      messageToken: data.messageToken || "",
      originalContent: data.originalContent || "",
      fileName,
    };
  }, [data]);
};
