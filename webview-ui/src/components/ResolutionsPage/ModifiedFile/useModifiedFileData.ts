import { useMemo } from "react";
import { ModifiedFileMessageValue, LocalChange } from "@editor-extensions/shared";

// Helper functions to check data types
const isModifiedFileMessageValue = (data: any): data is ModifiedFileMessageValue => {
  return "path" in data && typeof data.path === "string";
};

const isLocalChange = (data: any): data is LocalChange => {
  return "originalUri" in data;
};

// Helper function to determine status from LocalChange state
const getStatusFromState = (state: string): "applied" | "rejected" | null => {
  if (state === "applied") {
    return "applied";
  } else if (state === "discarded") {
    return "rejected";
  } else {
    return null;
  }
};

// Helper function to extract path from LocalChange originalUri
const getPathFromOriginalUri = (originalUri: string | { fsPath: string }): string => {
  if (typeof originalUri === "string") {
    return originalUri;
  } else {
    return originalUri.fsPath;
  }
};

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

export const useModifiedFileData = (
  data: ModifiedFileMessageValue | LocalChange,
): NormalizedFileData => {
  return useMemo(() => {
    let normalized: Omit<NormalizedFileData, "fileName">;

    if (isModifiedFileMessageValue(data)) {
      normalized = {
        path: data.path,
        isNew: data.isNew || false,
        isDeleted: data.isDeleted || false,
        diff: data.diff || "",
        status: (data.status as "applied" | "rejected" | null) || null,
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
    } else if (isLocalChange(data)) {
      normalized = {
        path: getPathFromOriginalUri(data.originalUri),
        isNew: false,
        isDeleted: false,
        diff: data.diff || "",
        status: getStatusFromState(data.state),
        content: data.content || "",
        messageToken: data.messageToken || "",
        quickResponses: undefined,
        originalContent: "",
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

// Export helper functions for reuse
export { isModifiedFileMessageValue, isLocalChange };
