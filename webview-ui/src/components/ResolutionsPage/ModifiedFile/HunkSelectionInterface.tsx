import React from "react";
import { Button, Flex, FlexItem, Badge } from "@patternfly/react-core";
import { CheckCircleIcon, TimesCircleIcon } from "@patternfly/react-icons";
import { DiffLegend } from "./DiffLegend";
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
}

export const HunkSelectionInterface: React.FC<HunkSelectionInterfaceProps> = ({
  parsedHunks,
  hunkStates,
  onHunkStateChange,
  actionTaken,
  filePath,
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

  return (
    <div className="hunk-selection-interface">
      <div className="hunk-selection-header">
        <h3 className="hunk-selection-title">Review Changes</h3>
        <span className="hunk-count">
          {parsedHunks.length} change{parsedHunks.length !== 1 ? "s" : ""} found
        </span>
      </div>

      {parsedHunks.map((hunk, index) => {
        const buttonVariants = getButtonVariants(hunk.id);
        const isDisabled = actionTaken !== null;

        return (
          <div key={hunk.id} className="hunk-item">
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
                        >
                          Reject
                        </Button>
                      </FlexItem>
                      <FlexItem>
                        {/* <Button
                          variant={buttonVariants.pending}
                          size="sm"
                          icon={<MinusCircleIcon />}
                          onClick={() => onHunkStateChange(hunk.id, 'pending')}
                          isDisabled={isDisabled}
                          title="Mark as pending (skip for now)"
                        >
                          Skip
                        </Button> */}
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
