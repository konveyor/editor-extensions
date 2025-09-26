import { useMemo } from "react";
import { ModifiedFileMessageValue } from "@editor-extensions/shared";

// Helper functions to check data types
const isModifiedFileMessageValue = (data: any): data is ModifiedFileMessageValue => {
  return "path" in data && typeof data.path === "string";
};

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
    let normalized: Omit<NormalizedFileData, "fileName">;

    if (isModifiedFileMessageValue(data)) {
      normalized = {
        path: data.path,
        isNew: data.isNew || false,
        isDeleted: data.isDeleted || false,
        diff: data.diff || "",
        status: (data.status as "applied" | "rejected" | "no_changes_needed" | null) || null,
        content: data.content || "",
        messageToken: data.messageToken || "",
        quickResponses:
          data.quickResponses &&
          Array.isArray(data.quickResponses) &&
          data.quickResponses.length > 0
            ? data.quickResponses
            : undefined,
        originalContent: data.originalContent || "",
      };
    } else {
      // Fallback for unknown data types
      normalized = {
        path: "",
        isNew: false,
        isDeleted: false,
        diff: "",
        status: null,
        content: "",
        messageToken: "",
        quickResponses: undefined,
        originalContent: "",
      };
    }

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
