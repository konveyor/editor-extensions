import { useMemo } from "react";
import { ModifiedFileMessageValue } from "@editor-extensions/shared";
import { getWorkspaceRelativePath } from "../../../utils/workspacePath";

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
  workspaceRoots: string[] = [],
): NormalizedFileData => {
  return useMemo(() => {
    const normalizedPath = data.path.replace(/\\/g, "/");

    const roots = workspaceRoots.length > 0 ? workspaceRoots : workspaceRoot ? [workspaceRoot] : [];
    const fileName =
      getWorkspaceRelativePath(data.path, roots) ||
      normalizedPath.split("/").pop() ||
      data.path ||
      "Unnamed File";

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
  }, [data, workspaceRoot, workspaceRoots]);
};
