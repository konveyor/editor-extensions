import React from "react";
import { Card, CardBody } from "@patternfly/react-core";
import {
  ModifiedFileMessageValue,
  isOnlyLineEndingDiff,
  hasNoMeaningfulDiffContent,
} from "@editor-extensions/shared";
import "./modifiedFileMessage.css";
import ModifiedFileHeader from "./ModifiedFileHeader";
import ModifiedFileDiffPreview from "./ModifiedFileDiffPreview";
import { useModifiedFileData } from "./useModifiedFileData";

interface ModifiedFileMessageProps {
  data: ModifiedFileMessageValue;
  timestamp?: string;
}

/**
 * ModifiedFileMessage - Read-only display component for file changes
 *
 * This component now serves purely as a contextual display showing what files
 * the AI has modified. All user interactions (accept/reject) are handled in
 * the BatchReviewModal at the end of the workflow.
 *
 * This simplifies the flow: files accumulate in pendingBatchReview state and
 * users review them all at once rather than one-by-one.
 */
export const ModifiedFileMessage: React.FC<ModifiedFileMessageProps> = React.memo(
  ({ data, timestamp }) => {
    // Use shared data normalization hook
    const normalizedData = useModifiedFileData(data);
    const { isNew, diff, path, fileName } = normalizedData;

    // Check if diff has no meaningful changes
    const isOnlyLineEndingChanges = Boolean(diff && isOnlyLineEndingDiff(diff));
    const hasNoMeaningfulChanges = Boolean(diff && hasNoMeaningfulDiffContent(diff));
    const shouldShowNoChangesNeeded =
      !diff || diff.trim() === "" || isOnlyLineEndingChanges || hasNoMeaningfulChanges;

    // All ModifiedFile messages are now read-only (for context)
    // User actions happen in BatchReviewModal
    return (
      <div className="modified-file-message modified-file-readonly">
        <Card className="modified-file-card readonly-card">
          <ModifiedFileHeader
            isNew={isNew}
            fileName={fileName}
            timestamp={timestamp}
            readOnly={true}
          />
          <CardBody>
            {shouldShowNoChangesNeeded ? (
              <div style={{ padding: "1em", textAlign: "center", color: "#6a6e73" }}>
                <p style={{ margin: 0 }}>ℹ️ No changes detected in this file</p>
                <small style={{ fontStyle: "italic" }}>
                  This will be available for review at the end
                </small>
              </div>
            ) : (
              <>
                <ModifiedFileDiffPreview diff={diff} path={path} />
                <div className="readonly-notice">
                  <small style={{ color: "#6a6e73", fontStyle: "italic" }}>
                    This change will be available for review at the end
                  </small>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </div>
    );
  },
);

ModifiedFileMessage.displayName = "ModifiedFileMessage";

export default ModifiedFileMessage;
