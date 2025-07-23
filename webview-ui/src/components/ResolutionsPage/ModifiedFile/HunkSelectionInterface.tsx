import React from "react";
import { Button, Flex, FlexItem, Badge } from "@patternfly/react-core";
import { CheckCircleIcon, TimesCircleIcon } from "@patternfly/react-icons";
import { DiffLegend } from "./DiffLegend";
import "./modifiedFileMessage.css";
import { DiffLinesRenderer } from "./DiffLinesRenderer";

interface ParsedHunk {
  id: string;
  header: string;
  changes: string[];
}

// Define hunk state type - 3-state system
type HunkState = "pending" | "accepted" | "rejected";

interface HunkSelectionInterfaceProps {
  parsedHunks: ParsedHunk[];
  hunkStates: Record<string, HunkState>;
  onHunkStateChange: (hunkId: string, state: HunkState) => void;
  actionTaken: "applied" | "rejected" | null;
  filePath: string;
  pendingHunks?: Set<string>;
  acceptedHunks?: Set<string>;
  rejectedHunks?: Set<string>;
}

export const HunkSelectionInterface: React.FC<HunkSelectionInterfaceProps> = ({
  parsedHunks,
  hunkStates,
  onHunkStateChange,
  actionTaken,
  filePath,
  pendingHunks = new Set(),
  acceptedHunks = new Set(),
  rejectedHunks = new Set(),
}) => {
  const getHunkStatusBadge = (hunkId: string) => {
    const state = hunkStates[hunkId];
    switch (state) {
      case "accepted":
        return <Badge isRead>Accepted</Badge>;
      case "rejected":
        return <Badge isRead>Rejected</Badge>;
      case "pending":
      default:
        return <Badge isRead>Pending</Badge>;
    }
  };

  const getButtonVariants = (hunkId: string) => {
    const state = hunkStates[hunkId];
    return {
      accept: state === "accepted" ? ("primary" as const) : ("secondary" as const),
      reject: state === "rejected" ? ("danger" as const) : ("secondary" as const),
      pending: state === "pending" ? ("tertiary" as const) : ("secondary" as const),
    };
  };

  const getHunkItemClassName = (hunkId: string) => {
    const state = hunkStates[hunkId];
    const baseClass = "hunk-item";
    switch (state) {
      case "accepted":
        return `${baseClass} hunk-accepted`;
      case "rejected":
        return `${baseClass} hunk-rejected`;
      case "pending":
      default:
        return `${baseClass} hunk-pending`;
    }
  };

  return (
    <div className="hunk-selection-interface">
      {parsedHunks.map((hunk, index) => {
        const buttonVariants = getButtonVariants(hunk.id);
        const isDisabled = actionTaken !== null;
        const hunkItemClassName = getHunkItemClassName(hunk.id);

        return (
          <div key={hunk.id} className={hunkItemClassName}>
            <div className="hunk-item-header">
              <Flex
                justifyContent={{ default: "justifyContentSpaceBetween" }}
                alignItems={{ default: "alignItemsCenter" }}
              >
                <FlexItem flex={{ default: "flex_1" }}>
                  <div className="hunk-info">
                    <span className="hunk-number">Change {index + 1}</span>
                    <span className="hunk-description">{hunk.header}</span>
                    {getHunkStatusBadge(hunk.id)}
                  </div>
                </FlexItem>

                <FlexItem>
                  <div className="hunk-controls">
                    <Flex gap={{ default: "gapSm" }}>
                      <FlexItem>
                        <Button
                          variant={buttonVariants.accept}
                          size="sm"
                          icon={<CheckCircleIcon />}
                          onClick={() => onHunkStateChange(hunk.id, "accepted")}
                          isDisabled={isDisabled}
                          title="Accept this change"
                          className={
                            hunkStates[hunk.id] === "accepted"
                              ? "hunk-accept active"
                              : "hunk-accept"
                          }
                        >
                          Accept
                        </Button>
                      </FlexItem>
                      <FlexItem>
                        <Button
                          variant={buttonVariants.reject}
                          size="sm"
                          icon={<TimesCircleIcon />}
                          onClick={() => onHunkStateChange(hunk.id, "rejected")}
                          isDisabled={isDisabled}
                          title="Reject this change"
                          className={
                            hunkStates[hunk.id] === "rejected"
                              ? "hunk-reject active"
                              : "hunk-reject"
                          }
                        >
                          Reject
                        </Button>
                      </FlexItem>
                      <FlexItem>
                        <Button
                          variant={buttonVariants.pending}
                          size="sm"
                          onClick={() => onHunkStateChange(hunk.id, "pending")}
                          isDisabled={isDisabled}
                          title="Mark as pending (skip for now)"
                          className={
                            hunkStates[hunk.id] === "pending"
                              ? "hunk-pending active"
                              : "hunk-pending"
                          }
                        >
                          Skip
                        </Button>
                      </FlexItem>
                    </Flex>
                  </div>
                </FlexItem>
              </Flex>
            </div>
            <div className="hunk-content">
              <DiffLegend />
              <DiffLinesRenderer diffContent={hunk.changes.join("\n")} filePath={filePath} />
            </div>
          </div>
        );
      })}
    </div>
  );
};
