import { useMemo } from "react";
import { ModifiedFileMessageValue } from "@editor-extensions/shared";

export interface NormalizedFileData {
  path: string;
  isNew: boolean;
  isDeleted: boolean;
  diff: string;
  status: "applied" | "rejected" | null;
  content: string;
  messageToken: string;
  quickResponses?: Array<{ id: string; content: string }>;
  originalContent: string;
  fileName: string;
}

export const useModifiedFileData = (data: ModifiedFileMessageValue): NormalizedFileData => {
  return useMemo(() => {
    const normalized: Omit<NormalizedFileData, "fileName"> = {
      path: data.path,
      isNew: data.isNew || false,
      isDeleted: data.isDeleted || false,
      diff: data.diff || "",
      status: (data.status as "applied" | "rejected" | null) || null,
      content: data.content || "",
      messageToken: data.messageToken || "",
      quickResponses:
        data.quickResponses && Array.isArray(data.quickResponses) && data.quickResponses.length > 0
          ? data.quickResponses
          : undefined,
      originalContent: data.originalContent || "",
    };

    // Generate fileName from path
    const fileName =
      normalized.path && typeof normalized.path === "string" && normalized.path.trim() !== ""
        ? normalized.path.split("/").pop() || normalized.path
        : "Unnamed File";

    return {
      ...normalized,
      fileName,
    };
  }, [data]);
};
