import React, { useState } from "react";
import type { GooseContentBlock } from "@editor-extensions/shared";

interface ResourceBlockProps {
  block: Extract<GooseContentBlock, { type: "resource" }>;
}

export const ResourceBlock: React.FC<ResourceBlockProps> = ({ block }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const displayName = block.name || block.uri.split("/").pop() || block.uri;
  const content = block.text || "(binary content)";

  return (
    <div className="goose-resource-block">
      <button
        className="goose-resource-block__header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <span className="goose-resource-block__toggle">{isExpanded ? "▼" : "▶"}</span>
        <span className="goose-resource-block__name">{displayName}</span>
        {block.mimeType && (
          <span className="goose-resource-block__mime">{block.mimeType}</span>
        )}
      </button>
      {isExpanded && (
        <pre className="goose-resource-block__content">
          <code>{content}</code>
        </pre>
      )}
    </div>
  );
};
