import React, { useEffect, useState, useMemo } from "react";
import { Modal, ModalVariant } from "@patternfly/react-core";

import { parsePatch, applyPatch } from "diff";
import { SingleHunkDisplay } from "./SingleHunkDisplay";
import { HunkSelectionInterface } from "./HunkSelectionInterface";
import { ModifiedFileModalHeader } from "./ModifiedFileModalHeader";

interface ParsedHunk {
  id: string;
  header: string;
  changes: string[];
}

import { ModifiedFileMessageValue, LocalChange } from "@editor-extensions/shared";
import { useModifiedFileData } from "./useModifiedFileData";

interface ModifiedFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: ModifiedFileMessageValue | LocalChange;
  actionTaken: "applied" | "rejected" | null;
  onApply: (selectedContent: string) => void;
  onReject: () => void;
}

export const ModifiedFileModal: React.FC<ModifiedFileModalProps> = ({
  isOpen,
  onClose,
  data,
  actionTaken,
  onApply,
  onReject,
}) => {
  // Use shared data normalization hook
  const normalizedData = useModifiedFileData(data);
  const { path, isNew, diff, content, originalContent, fileName } = normalizedData;
  // Parse single-file, multi-hunk diff using proper diff library
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
    } catch (error) {
      // Silently handle diff parsing errors and return null
      return null;
    }
  }, [diff]);

  const parsedHunks = parsedDiff?.hunks || [];
  const [hunkStates, setHunkStates] = useState<Record<string, boolean>>({});

  // Update hunkStates when parsedHunks changes
  useEffect(() => {
    const newHunkStates: Record<string, boolean> = {};
    parsedHunks.forEach((hunk) => {
      newHunkStates[hunk.id] = true; // Default to accepted
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

      // Hunk-level selection logic
      const noHunksAccepted = parsedHunks.every((hunk) => !hunkStates[hunk.id]);
      if (noHunksAccepted) {
        return originalContent; // Return original content unchanged
      }

      const allHunksAccepted = parsedHunks.every((hunk) => hunkStates[hunk.id]);
      if (allHunksAccepted) {
        return modifiedContent; // All hunks accepted - return the agent's modified content
      }

      // Partial selection - create a new patch with only selected hunks
      const selectedHunks = parsedHunks.filter((hunk) => hunkStates[hunk.id]);

      if (selectedHunks.length === 0) {
        return originalContent; // No hunks selected, return original
      }

      // For partial selection, we'll reconstruct a patch with only selected hunks
      // and apply it to the original content
      const filename = parsedDiff.filename || path;
      let patchString = `--- a/${filename}\n+++ b/${filename}\n`;

      try {
        // Build patch string with selected hunks
        for (const hunk of selectedHunks) {
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
        throw new Error(`Failed to apply patch: ${errorMessage}`);
      }
    } catch (error) {
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
  };

  // Modal-specific reject handler
  const handleModalReject = () => {
    onReject();
  };

  // Helper to handle hunk state changes
  const handleHunkStateChange = (hunkId: string, accepted: boolean) => {
    setHunkStates((prev) => ({ ...prev, [hunkId]: accepted }));
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
            onHunkStateChange={handleHunkStateChange}
            actionTaken={actionTaken}
            filePath={path}
          />
        )}
      </div>
    );
  };
  const isSingleHunk = parsedHunks.length <= 1;

  // Handlers for multi-hunk selection
  const handleSelectAll = () => {
    const newStates: Record<string, boolean> = {};
    parsedHunks.forEach((hunk) => {
      newStates[hunk.id] = true;
    });
    setHunkStates(newStates);
  };

  const handleDeselectAll = () => {
    const newStates: Record<string, boolean> = {};
    parsedHunks.forEach((hunk) => {
      newStates[hunk.id] = false;
    });
    setHunkStates(newStates);
  };

  return (
    <Modal variant={ModalVariant.large} isOpen={isOpen} className="modified-file-modal">
      <div className="expanded-modal-content">
        <ModifiedFileModalHeader
          isNew={isNew}
          fileName={fileName}
          isSingleHunk={isSingleHunk}
          actionTaken={actionTaken}
          parsedHunks={parsedHunks}
          hunkStates={hunkStates}
          onClose={onClose}
          onApply={handleModalApply}
          onReject={handleModalReject}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
        />

        <div className="modal-content-scrollable">{renderExpandedDiff()}</div>
      </div>
    </Modal>
  );
};

export default ModifiedFileModal;
