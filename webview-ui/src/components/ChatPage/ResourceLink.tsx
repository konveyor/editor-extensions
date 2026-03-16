import React from "react";
import type { AgentContentBlock } from "@editor-extensions/shared";

interface ResourceLinkProps {
  block: Extract<AgentContentBlock, { type: "resource_link" }>;
}

export const ResourceLink: React.FC<ResourceLinkProps> = ({ block }) => {
  const displayName = block.name || block.uri.split("/").pop() || block.uri;
  const isFileUri = block.uri.startsWith("file://");

  const handleClick = () => {
    if (isFileUri) {
      window.vscode.postMessage({
        type: "OPEN_FILE",
        payload: { uri: block.uri },
      });
    }
  };

  if (isFileUri) {
    return (
      <span className="agent-resource-link agent-resource-link--file" onClick={handleClick}>
        <span className="agent-resource-link__icon">📄</span>
        <span className="agent-resource-link__name">{displayName}</span>
      </span>
    );
  }

  return (
    <a className="agent-resource-link" href={block.uri} target="_blank" rel="noopener noreferrer">
      <span className="agent-resource-link__icon">🔗</span>
      <span className="agent-resource-link__name">{displayName}</span>
    </a>
  );
};
