import React, { useMemo, useState } from "react";
import { filterLineEndingOnlyChanges } from "@editor-extensions/shared";
import avatar from "../../../public/avatarIcons/avatar.svg?inline";
import { getBrandName } from "../../utils/branding";
import "./PermissionReviewMessage.css";

interface QuickResponseItem {
  id: string;
  content: string;
  messageToken: string;
  isDisabled?: boolean;
  isSelected?: boolean;
}

interface PermissionReviewMessageProps {
  content: string;
  timestamp?: string | Date;
  quickResponses?: QuickResponseItem[];
}

interface ParsedPermission {
  label: string;
  filePath: string | null;
  diff: string | null;
}

function parsePermissionContent(raw: string): ParsedPermission {
  const labelMatch = raw.match(/\*\*Review:\*\*\s*(.+?)(?:\n|$)/);
  const label = labelMatch ? labelMatch[1].trim() : raw.split("\n")[0];

  const pathMatch = label.match(/(?:Edit|Write|Create|Insert):\s*(.+)/i);
  const filePath = pathMatch ? pathMatch[1].trim() : null;

  const diffMatch = raw.match(/```diff\n([\s\S]*?)```/);
  const diff = diffMatch ? diffMatch[1].trim() : null;

  return { label, filePath, diff };
}

interface DiffStats {
  additions: number;
  deletions: number;
}

function computeStats(diff: string): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
    }
  }
  return { additions, deletions };
}

interface ParsedLine {
  type: "addition" | "deletion" | "context" | "hunk-header";
  content: string;
}

function parseDiffLines(diff: string): ParsedLine[] {
  const filtered = filterLineEndingOnlyChanges(diff.split("\n"));
  const lines: ParsedLine[] = [];
  let inHunk = false;

  for (const line of filtered) {
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      lines.push({ type: "hunk-header", content: line });
      continue;
    }
    if (!inHunk) {
      continue;
    }
    if (line.startsWith("+")) {
      lines.push({ type: "addition", content: line.slice(1) });
    } else if (line.startsWith("-")) {
      lines.push({ type: "deletion", content: line.slice(1) });
    } else {
      lines.push({ type: "context", content: line.startsWith(" ") ? line.slice(1) : line });
    }
  }
  return lines;
}

export const PermissionReviewMessage: React.FC<PermissionReviewMessageProps> = React.memo(
  ({ content, timestamp, quickResponses }) => {
    const [responded, setResponded] = useState<string | null>(() => {
      return quickResponses?.find((r) => r.isSelected)?.id ?? null;
    });

    React.useEffect(() => {
      const sel = quickResponses?.find((r) => r.isSelected)?.id ?? null;
      setResponded(sel);
    }, [quickResponses]);

    const parsed = useMemo(() => parsePermissionContent(content), [content]);
    const diffLines = useMemo(
      () => (parsed.diff ? parseDiffLines(parsed.diff) : []),
      [parsed.diff],
    );
    const stats = useMemo(
      () => (parsed.diff ? computeStats(parsed.diff) : { additions: 0, deletions: 0 }),
      [parsed.diff],
    );

    const formatTimestamp = (time: string | Date): string => {
      const date = typeof time === "string" ? new Date(time) : time;
      return date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    };

    const handleResponse = (responseId: string, messageToken: string) => {
      setResponded(responseId);
      if (messageToken.startsWith("perm-")) {
        window.vscode.postMessage({
          type: "AGENT_PERMISSION_RESPONSE",
          payload: { messageToken, optionId: responseId },
        });
      } else {
        window.vscode.postMessage({
          type: "QUICK_RESPONSE",
          payload: { responseId, messageToken },
        });
      }
    };

    const fileName = parsed.filePath?.split("/").pop() ?? null;
    const isAccepted = responded != null;
    const acceptResponse = quickResponses?.find((r) =>
      r.content.toLowerCase().includes("accept"),
    );
    const rejectResponse = quickResponses?.find((r) =>
      r.content.toLowerCase().includes("reject"),
    );

    return (
      <div className="prm">
        {/* Avatar + name row */}
        <div className="prm__meta">
          <img src={avatar} alt="" className="prm__avatar" />
          <span className="prm__name">{getBrandName()}</span>
          {timestamp && (
            <span className="prm__timestamp">{formatTimestamp(timestamp)}</span>
          )}
        </div>

        {/* File change card */}
        <div className="prm__card">
          <div className="prm__card-header">
            <div className="prm__card-header-left">
              <span className="prm__action-label">{parsed.label}</span>
            </div>
            {parsed.diff && (
              <div className="prm__card-stats">
                {stats.additions > 0 && (
                  <span className="prm__stat prm__stat--add">+{stats.additions}</span>
                )}
                {stats.deletions > 0 && (
                  <span className="prm__stat prm__stat--del">−{stats.deletions}</span>
                )}
              </div>
            )}
          </div>

          {diffLines.length > 0 && (
            <div className="prm__diff">
              <pre className="prm__diff-pre">
                {diffLines.map((line, i) => (
                  <div key={i} className={`prm__line prm__line--${line.type}`}>
                    <span className="prm__gutter">
                      {line.type === "addition"
                        ? "+"
                        : line.type === "deletion"
                          ? "−"
                          : line.type === "hunk-header"
                            ? "@@"
                            : " "}
                    </span>
                    <span className="prm__code">{line.content}</span>
                  </div>
                ))}
              </pre>
            </div>
          )}

          {/* Accept / Reject */}
          {quickResponses && quickResponses.length > 0 && (
            <div className="prm__actions">
              {rejectResponse && (
                <button
                  className={`prm__btn prm__btn--reject ${responded === rejectResponse.id ? "prm__btn--selected" : ""}`}
                  onClick={() =>
                    handleResponse(rejectResponse.id, rejectResponse.messageToken)
                  }
                  disabled={isAccepted}
                >
                  Reject
                </button>
              )}
              {acceptResponse && (
                <button
                  className={`prm__btn prm__btn--accept ${responded === acceptResponse.id ? "prm__btn--selected" : ""}`}
                  onClick={() =>
                    handleResponse(acceptResponse.id, acceptResponse.messageToken)
                  }
                  disabled={isAccepted}
                >
                  Accept
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  },
);

PermissionReviewMessage.displayName = "PermissionReviewMessage";

export default PermissionReviewMessage;
