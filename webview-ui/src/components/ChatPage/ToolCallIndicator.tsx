import React from "react";

interface ToolCallIndicatorProps {
  name: string;
  status: "running" | "succeeded" | "failed" | "pending";
  result?: string;
}

export const ToolCallIndicator: React.FC<ToolCallIndicatorProps> = ({
  name,
  status,
}) => {
  const isRunning = status === "running" || status === "pending";

  return (
    <div className={`goose-tool-call goose-tool-call--${status}`}>
      <span className="goose-tool-call__icon">
        {isRunning ? "⚙️" : status === "succeeded" ? "✓" : "✗"}
      </span>
      <span className="goose-tool-call__name">{name}</span>
      {isRunning && <span className="goose-tool-call__spinner" />}
    </div>
  );
};
