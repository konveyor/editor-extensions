import React from "react";
import { ModifiedFileMessageValue } from "@editor-extensions/shared";
import { useModifiedFileData } from "../ResolutionsPage/ModifiedFile";
import "./CompactModifiedFile.css";

interface CompactModifiedFileProps {
  data: ModifiedFileMessageValue;
  timestamp?: string;
}

/**
 * Sidebar-friendly modified file indicator.
 * Shows filename + status in a single compact line instead of rendering
 * the full inline diff.
 */
export const CompactModifiedFile: React.FC<CompactModifiedFileProps> = React.memo(({ data }) => {
  const { isNew, isDeleted, diff, fileName } = useModifiedFileData(data);
  const noChanges = !diff || diff.trim() === "";

  const label = isNew ? "created" : isDeleted ? "deleted" : noChanges ? "unchanged" : "modified";

  return (
    <div className="compact-modified-file">
      <span className="compact-modified-file__icon">
        {isNew ? "+" : isDeleted ? "−" : noChanges ? "·" : "~"}
      </span>
      <span className="compact-modified-file__name" title={data.path || fileName}>
        {fileName}
      </span>
      <span className={`compact-modified-file__label compact-modified-file__label--${label}`}>
        {label}
      </span>
    </div>
  );
});

CompactModifiedFile.displayName = "CompactModifiedFile";

export default CompactModifiedFile;
