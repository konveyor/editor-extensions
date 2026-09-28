import React, { useState } from "react";
import type { AgentContentBlock } from "@editor-extensions/shared";

interface ResourceBlockProps {
  block: Extract<AgentContentBlock, { type: "resource" }>;
}

export const ResourceBlock: React.FC<ResourceBlockProps> = ({ block }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const displayName = block.name || block.uri.split("/").pop() || block.uri;
  const content = block.text ?? "(binary content)";

  return (
    <div className="agent-resource-block">
      <button
        className="agent-resource-block__header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <span className="agent-resource-block__toggle">{isExpanded ? "▼" : "▶"}</span>
        <span className="agent-resource-block__name">{displayName}</span>
        {block.mimeType && <span className="agent-resource-block__mime">{block.mimeType}</span>}
      </button>
      {isExpanded && (
        <pre className="agent-resource-block__content">
          <code>{content}</code>
        </pre>
      )}
    </div>
  );
};
