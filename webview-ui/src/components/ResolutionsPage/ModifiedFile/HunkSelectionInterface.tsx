import React from "react";
import { Button } from "@patternfly/react-core";
import { CheckCircleIcon, TimesCircleIcon } from "@patternfly/react-icons";
import { DiffLegend } from "./DiffLegend";
import { DiffLinesRenderer } from "./DiffLinesRenderer";

interface ParsedHunk {
  id: string;
  header: string;
  changes: string[];
}

interface HunkSelectionInterfaceProps {
  parsedHunks: ParsedHunk[];
  hunkStates: Record<string, boolean>;
  onHunkStateChange: (hunkId: string, accepted: boolean) => void;
  actionTaken: "applied" | "rejected" | null;
  filePath: string;
}

export const HunkSelectionInterface: React.FC<HunkSelectionInterfaceProps> = ({
  parsedHunks,
  hunkStates,
  onHunkStateChange,
  actionTaken,
  filePath,
}) => {
  return (
    <div className="hunk-selection-interface">
      <div className="hunk-selection-header">
        <h3 className="hunk-selection-title">Review Changes</h3>
        <span className="hunk-count">
          {parsedHunks.length} change{parsedHunks.length !== 1 ? "s" : ""} found
        </span>
      </div>

      {parsedHunks.map((hunk, index) => (
        <div key={hunk.id} className="hunk-item">
          <div className="hunk-item-header">
            <div className="hunk-info">
              <span className="hunk-number">Change {index + 1}</span>
              <span className="hunk-description">{hunk.header}</span>
            </div>
            <div className="hunk-controls">
              <Button
                variant={hunkStates[hunk.id] ? "primary" : "secondary"}
                size="sm"
                icon={<CheckCircleIcon />}
                onClick={() => onHunkStateChange(hunk.id, true)}
                isDisabled={actionTaken !== null}
              >
                Accept
              </Button>
              <Button
                variant={!hunkStates[hunk.id] ? "danger" : "secondary"}
                size="sm"
                icon={<TimesCircleIcon />}
                onClick={() => onHunkStateChange(hunk.id, false)}
                isDisabled={actionTaken !== null}
              >
                Reject
              </Button>
            </div>
          </div>
          <div className="hunk-content">
            <DiffLegend />
            <DiffLinesRenderer diffContent={hunk.changes.join("\n")} filePath={filePath} />
          </div>
        </div>
      ))}
    </div>
  );
};
