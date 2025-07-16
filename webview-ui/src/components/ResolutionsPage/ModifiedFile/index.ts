// Modified File Components - Centralized exports
export { ModifiedFileMessage } from "./ModifiedFileMessage";
export { ModifiedFileModal } from "./ModifiedFileModal";
export { ModifiedFileModalHeader } from "./ModifiedFileModalHeader";
export { ModifiedFileHeader } from "./ModifiedFileHeader";
export { ModifiedFileActions } from "./ModifiedFileActions";
export { ModifiedFileDiffPreview } from "./ModifiedFileDiffPreview";

// Diff Components
export { DiffLinesRenderer } from "./DiffLinesRenderer";
export { DiffLegend } from "./DiffLegend";
export { HunkSelectionInterface } from "./HunkSelectionInterface";
export { SingleHunkDisplay } from "./SingleHunkDisplay";

// Utilities and Hooks
export { useModifiedFileData, isLocalChange } from "./useModifiedFileData";
export type { NormalizedFileData } from "./useModifiedFileData";
