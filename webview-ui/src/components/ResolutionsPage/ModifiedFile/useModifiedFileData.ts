import { useMemo } from "react";
import { ModifiedFileMessageValue } from "@editor-extensions/shared";

export interface NormalizedFileData {
  path: string;
  isNew: boolean;
  isDeleted: boolean;
  diff: string;
  status: "applied" | "rejected" | "no_changes_needed" | null;
  content: string;
  messageToken: string;
  quickResponses?: Array<{ id: string; content: string }>;
  originalContent: string;
  fileName: string;
}

export const useModifiedFileData = (data: ModifiedFileMessageValue): NormalizedFileData => {
  return useMemo(() => {
    const normalized = {
      path: data.path,
      isNew: data.isNew,
      isDeleted: data.isDeleted || false,
      diff: data.diff,
      status: data.status || null,
      content: data.content,
      messageToken: data.messageToken || "",
      quickResponses:
        data.quickResponses && data.quickResponses.length > 0 ? data.quickResponses : undefined,
      originalContent: data.originalContent || "",
    };

    // Generate fileName from path
    const fileName = data.path.split("/").pop() || data.path || "Unnamed File";

    return {
      ...normalized,
      fileName,
    };
  }, [data]);
};
