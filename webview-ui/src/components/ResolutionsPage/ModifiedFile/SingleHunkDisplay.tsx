import React from "react";
import { DiffLegend } from "./DiffLegend";
import { DiffLinesRenderer } from "./DiffLinesRenderer";
import { EnhancedDiffRenderer } from "./EnhancedDiffRenderer";
import "./modifiedFileMessage.css";

interface SingleHunkDisplayProps {
  diff: string;
  filePath: string;
  content?: string;
  useEnhanced?: boolean; // Whether to use enhanced renderer for large diffs
}

export const SingleHunkDisplay: React.FC<SingleHunkDisplayProps> = ({
  diff,
  filePath,
  content,
  useEnhanced = true,
}) => {
  // Determine if we should use enhanced renderer based on diff size
  const lineCount = diff.split("\n").length;
  const shouldUseEnhanced = useEnhanced && lineCount > 50;

  return (
    <div className="expanded-diff-display">
      <DiffLegend />
      {shouldUseEnhanced ? (
        <EnhancedDiffRenderer
          diffContent={diff}
          filePath={filePath}
          content={content}
          maxHeight={500}
          lineHeight={24}
          enableVirtualization={lineCount > 100}
        />
      ) : (
        <DiffLinesRenderer diffContent={diff} filePath={filePath} content={content} />
      )}
    </div>
  );
};
