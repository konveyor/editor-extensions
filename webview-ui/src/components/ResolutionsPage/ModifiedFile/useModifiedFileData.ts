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

export const useModifiedFileData = (data: ModifiedFileMessageValue): NormalizedFileData => {
  return useMemo(() => {
    // Generate fileName from path (normalize for cross-platform compatibility)
    const normalizedPath = data.path.replace(/\\/g, "/");
    const fileName = normalizedPath.split("/").pop() || data.path || "Unnamed File";

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
