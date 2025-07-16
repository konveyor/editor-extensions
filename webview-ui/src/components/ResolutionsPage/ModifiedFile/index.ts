// Modified File Components - Centralized exports

export { ModifiedFileModal } from "./ModifiedFileModal";
export { ModifiedFileDiffPreview } from "./ModifiedFileDiffPreview";
export { DiffLinesRenderer } from "./DiffLinesRenderer";
export { EnhancedDiffRenderer } from "./EnhancedDiffRenderer";
export { DiffLegend } from "./DiffLegend";
export { HunkSelectionInterface } from "./HunkSelectionInterface";
export { ModifiedFileHeader } from "./ModifiedFileHeader";
export { ModifiedFileModalHeader } from "./ModifiedFileModalHeader";
export { SingleHunkDisplay } from "./SingleHunkDisplay";
export { ModifiedFileMessage } from "./ModifiedFileMessage";
export { ModifiedFileActions } from "./ModifiedFileActions";
export { useModifiedFileData } from "./useModifiedFileData";

// Theme utilities
export {
  applyTheme,
  watchThemeChanges,
  getCurrentTheme,
} from "../../../utils/syntaxHighlightingTheme";

// Enhanced language detection
export {
  detectLanguage,
  isLanguageSupported,
} from "../../../../../shared/src/utils/languageMapping";
