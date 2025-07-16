import React from "react";
import { DiffLegend } from "./DiffLegend";
import { DiffLinesRenderer } from "./DiffLinesRenderer";

interface SingleHunkDisplayProps {
  diff: string;
  filePath: string;
}

export const SingleHunkDisplay: React.FC<SingleHunkDisplayProps> = ({ diff, filePath }) => {
  return (
    <div className="expanded-diff-display">
      <DiffLegend />
      <DiffLinesRenderer diffContent={diff} filePath={filePath} />
    </div>
  );
};
