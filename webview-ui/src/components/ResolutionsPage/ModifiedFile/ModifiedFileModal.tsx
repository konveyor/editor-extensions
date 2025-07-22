import React, { useEffect, useState, useMemo } from "react";
import { Modal, ModalVariant } from "@patternfly/react-core";

import { parsePatch, applyPatch } from "diff";
import { SingleHunkDisplay } from "./SingleHunkDisplay";
import { HunkSelectionInterface } from "./HunkSelectionInterface";
import { ModifiedFileModalHeader } from "./ModifiedFileModalHeader";

import { ModifiedFileMessageValue, LocalChange } from "@editor-extensions/shared";
import { useModifiedFileData } from "./useModifiedFileData";

// Define hunk state type - 3-state system
type HunkState = "pending" | "accepted" | "rejected";

interface ModifiedFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: ModifiedFileMessageValue | LocalChange;
  actionTaken: "applied" | "rejected" | null;
  onApply: (selectedContent: string) => void;
  onReject: () => void;
  onUserAction?: () => void;
}

export const ModifiedFileModal: React.FC<ModifiedFileModalProps> = ({
  isOpen,
  onClose,
  data,
  actionTaken,
  onApply,
  onReject,
  onUserAction,
}) => {
  const normalizedData = useModifiedFileData(data);
  const { path, isNew, diff, content, originalContent, fileName } = normalizedData;
  const parsedDiff = useMemo(() => {
    if (!diff) {
      return null;
    }

    try {
      // Use the proper diff library to parse the patch
      const patches = parsePatch(diff);

      if (!patches || patches.length === 0) {
        return null;
      }

      // We expect a single file patch since this component handles one file
      const patch = patches[0];

      // Transform library hunks into our format with IDs
      const hunks = patch.hunks.map((hunk, index) => ({
        id: `hunk-${index}`,
        hunk: hunk, // Keep the original hunk object for applying changes
        header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        changes: hunk.lines,
      }));

      return {
        filename: patch.oldFileName || patch.newFileName || "",
        hunks: hunks,
      };
    } catch {
      // Silently handle diff parsing errors and return null
      return null;
    }
  }, [diff]);

  const parsedHunks = parsedDiff?.hunks || [];
  const [hunkStates, setHunkStates] = useState<Record<string, HunkState>>({});

  // Update hunkStates when parsedHunks changes
  useEffect(() => {
    const newHunkStates: Record<string, HunkState> = {};
    parsedHunks.forEach((hunk) => {
      // For single hunks, default to 'accepted' so they can be applied directly
      // For multiple hunks, default to 'pending' so user must make explicit decisions
      newHunkStates[hunk.id] = parsedHunks.length === 1 ? "accepted" : "pending";
    });
    setHunkStates(newHunkStates);
  }, [parsedHunks]);

  // Generate content based on hunk selections using proper diff library
  const generateSelectedContent = (): string => {
    try {
      const modifiedContent = content;

      if (!parsedDiff || parsedHunks.length === 0) {
        return modifiedContent;
      }

      // For 3-state system: only apply ACCEPTED hunks
      const acceptedHunks = parsedHunks.filter((hunk) => hunkStates[hunk.id] === "accepted");

      if (acceptedHunks.length === 0) {
        return originalContent; // No hunks accepted - return original content unchanged
      }

      const allHunksAccepted = acceptedHunks.length === parsedHunks.length;

      if (allHunksAccepted) {
        return modifiedContent; // All hunks accepted - return the agent's modified content
      }

      // Partial selection - create a new patch with only accepted hunks
      const filename = parsedDiff.filename || path;
      let patchString = `--- a/${filename}\n+++ b/${filename}\n`;

      try {
        // Build patch string with accepted hunks
        for (const hunk of acceptedHunks) {
          if (!hunk.header) {
            throw new Error(`Missing header for hunk ${hunk.id}`);
          }
          if (!hunk.changes || !Array.isArray(hunk.changes)) {
            throw new Error(`Invalid changes array for hunk ${hunk.id}`);
          }

          patchString += hunk.header + "\n";
          patchString += hunk.changes.join("\n") + "\n";
        }
      } catch (patchConstructionError) {
        const errorMessage =
          patchConstructionError instanceof Error
            ? patchConstructionError.message
            : String(patchConstructionError);
        throw new Error(`Failed to construct patch string: ${errorMessage}`);
      }

      // Apply the partial patch to the original content
      let partiallyModified: string | false;
      try {
        partiallyModified = applyPatch(originalContent, patchString);

        if (partiallyModified === false) {
          throw new Error("applyPatch returned false - patch application failed");
        }

        return partiallyModified;
      } catch (patchApplicationError) {
        const errorMessage =
          patchApplicationError instanceof Error
            ? patchApplicationError.message
            : String(patchApplicationError);
        console.error("ModifiedFileModal: Patch application failed:", errorMessage);
        throw new Error(`Failed to apply patch: ${errorMessage}`);
      }
    } catch (error) {
      console.error("ModifiedFileModal: generateSelectedContent error:", error);
      // Fallback strategy: try to return original content, then modified content
      if (originalContent) {
        return originalContent;
      } else if (content) {
        return content;
      } else {
        return "";
      }
    }
  };

  // Modal-specific apply handler that generates selected content
  const handleModalApply = () => {
    const selectedContent = generateSelectedContent();
    onApply(selectedContent);
    onUserAction?.();
  };

  // Modal-specific reject handler
  const handleModalReject = () => {
    onReject();
    onUserAction?.();
  };

  // Helper to handle hunk state changes - now 3-state
  const handleHunkStateChange = (hunkId: string, newState: HunkState) => {
    setHunkStates((prev) => ({ ...prev, [hunkId]: newState }));
  };

  // Bridge function to convert 3-state to HunkState for HunkSelectionInterface compatibility
  const handleHunkStateChangeForInterface = (
    hunkId: string,
    state: "accepted" | "rejected" | "pending",
  ) => {
    handleHunkStateChange(hunkId, state);
  };

  // Select all hunks handler (set to accepted)
  const handleSelectAll = () => {
    const newHunkStates: Record<string, HunkState> = {};
    parsedHunks.forEach((hunk) => {
      newHunkStates[hunk.id] = "accepted";
    });
    setHunkStates(newHunkStates);
  };

  const renderExpandedDiff = () => {
    return (
      <div className="expanded-diff-content">
        {parsedHunks.length <= 1 ? (
          /* Single hunk or no hunks - show enhanced diff */
          <SingleHunkDisplay diff={diff} filePath={path} />
        ) : (
          /* Multiple hunks - show clean hunk selection interface */
          <HunkSelectionInterface
            parsedHunks={parsedHunks}
            hunkStates={hunkStates}
            onHunkStateChange={handleHunkStateChangeForInterface}
            actionTaken={actionTaken}
            filePath={path}
          />
        )}
      </div>
    );
  };

  const isSingleHunk = parsedHunks.length <= 1;

  // Calculate hunk summary for traditional submit system
  const getHunkSummary = () => {
    const total = parsedHunks.length;
    const accepted = parsedHunks.filter((hunk) => hunkStates[hunk.id] === "accepted").length;
    const rejected = parsedHunks.filter((hunk) => hunkStates[hunk.id] === "rejected").length;
    const pending = parsedHunks.filter((hunk) => hunkStates[hunk.id] === "pending").length;

    return { total, accepted, rejected, pending };
  };

  const hunkSummary = getHunkSummary();

  // Submit validation - can only submit if some decisions have been made
  const hasDecisions = hunkSummary.accepted > 0 || hunkSummary.rejected > 0;
  // For single hunks: always allow submit (they default to accepted)
  // For multiple hunks: only allow submit if decisions have been made
  const canSubmit = isSingleHunk || hasDecisions;

  return (
    <Modal variant={ModalVariant.large} isOpen={isOpen} className="modified-file-modal">
      <div className="expanded-modal-content">
        <ModifiedFileModalHeader
          isNew={isNew}
          fileName={fileName}
          isSingleHunk={isSingleHunk}
          actionTaken={actionTaken}
          hunkSummary={hunkSummary}
          canSubmit={canSubmit}
          onClose={onClose}
          onApply={handleModalApply}
          onReject={handleModalReject}
          onSelectAll={!isSingleHunk ? handleSelectAll : undefined}
          onUserAction={onUserAction}
        />

        <div className="modal-content-scrollable">{renderExpandedDiff()}</div>
      </div>
    </Modal>
  );
};

export default ModifiedFileModal;
