import React, { useState } from "react";

interface ThinkingIndicatorProps {
  thinkingText?: string;
}

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({ thinkingText }) => {
  const [expanded, setExpanded] = useState(false);
  const hasContent = thinkingText && thinkingText.trim().length > 0;

  return (
    <div className="agent-thinking" aria-label="Thinking">
      <button
        className="agent-thinking__toggle"
        onClick={() => hasContent && setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        disabled={!hasContent}
        type="button"
      >
        <span className="agent-thinking__dots">
          <span className="agent-thinking__dot" />
          <span className="agent-thinking__dot" />
          <span className="agent-thinking__dot" />
        </span>
        <span className="agent-thinking__label">Thinking</span>
        {hasContent && (
          <span className="agent-thinking__chevron" aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
        )}
      </button>
      {expanded && hasContent && <div className="agent-thinking__content">{thinkingText}</div>}
    </div>
  );
};

interface ThinkingBlockProps {
  text: string;
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ text }) => {
  const [expanded, setExpanded] = useState(false);

  if (!text || text.trim().length === 0) {
    return null;
  }

  return (
    <div className="agent-thinking-block">
      <button
        className="agent-thinking-block__header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        type="button"
      >
        <span className="agent-thinking-block__icon" aria-hidden="true">
          💭
        </span>
        <span className="agent-thinking-block__title">Thought process</span>
        <span className="agent-thinking-block__chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && <div className="agent-thinking-block__content">{text}</div>}
    </div>
  );
};
