import React from "react";
import type { GooseContentBlock } from "@editor-extensions/shared";

interface ResourceLinkProps {
  block: Extract<GooseContentBlock, { type: "resource_link" }>;
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
      <span className="goose-resource-link goose-resource-link--file" onClick={handleClick}>
        <span className="goose-resource-link__icon">📄</span>
        <span className="goose-resource-link__name">{displayName}</span>
      </span>
    );
  }

  return (
    <a
      className="goose-resource-link"
      href={block.uri}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="goose-resource-link__icon">🔗</span>
      <span className="goose-resource-link__name">{displayName}</span>
    </a>
  );
};
