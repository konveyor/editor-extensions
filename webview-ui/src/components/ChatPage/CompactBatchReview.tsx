import React, { useState } from "react";
import { useExtensionStore } from "../../store/store";
import "./CompactBatchReview.css";

export const CompactBatchReview: React.FC = () => {
  const pendingFiles = useExtensionStore((state) => state.pendingBatchReview || []);
  const isBatchOperationInProgress = useExtensionStore((state) => state.isBatchOperationInProgress);
  const setBatchOperationInProgress = useExtensionStore(
    (state) => state.setBatchOperationInProgress,
  );
  const [isApplying, setIsApplying] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  React.useEffect(() => {
    if (!isBatchOperationInProgress) {
      setIsApplying(false);
      setIsRejecting(false);
    }
  }, [isBatchOperationInProgress]);

  if (pendingFiles.length === 0) {
    return null;
  }

  const busy = isApplying || isRejecting || isBatchOperationInProgress;

  const handleApplyAll = () => {
    setIsApplying(true);
    setBatchOperationInProgress(true);
    window.vscode.postMessage({
      type: "BATCH_APPLY_ALL",
      payload: {
        files: pendingFiles.map((f) => ({
          messageToken: f.messageToken,
          path: f.path,
          content: f.content,
        })),
      },
    });
  };

  const handleRejectAll = () => {
    setIsRejecting(true);
    setBatchOperationInProgress(true);
    window.vscode.postMessage({
      type: "BATCH_REJECT_ALL",
      payload: {
        files: pendingFiles.map((f) => ({
          messageToken: f.messageToken,
          path: f.path,
        })),
      },
    });
  };

  return (
    <div className="compact-batch-review">
      <span className="compact-batch-review__label">
        <strong>{pendingFiles.length}</strong> file{pendingFiles.length > 1 ? "s" : ""}{" "}
        {isApplying ? "applying..." : isRejecting ? "rejecting..." : "ready for review"}
      </span>
      <span className="compact-batch-review__actions">
        <button
          className="compact-batch-review__btn compact-batch-review__btn--primary"
          onClick={handleApplyAll}
          disabled={busy}
        >
          Apply All
        </button>
        <button
          className="compact-batch-review__btn compact-batch-review__btn--danger"
          onClick={handleRejectAll}
          disabled={busy}
        >
          Reject All
        </button>
      </span>
    </div>
  );
};

export default CompactBatchReview;
