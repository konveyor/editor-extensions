import React, { useState } from "react";

interface ThinkingIndicatorProps {
  thinkingText?: string;
}

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({ thinkingText }) => {
  const [expanded, setExpanded] = useState(false);
  const hasContent = thinkingText && thinkingText.trim().length > 0;

  return (
    <div className="goose-thinking" aria-label="Thinking">
      <button
        className="goose-thinking__toggle"
        onClick={() => hasContent && setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        disabled={!hasContent}
        type="button"
      >
        <span className="goose-thinking__dots">
          <span className="goose-thinking__dot" />
          <span className="goose-thinking__dot" />
          <span className="goose-thinking__dot" />
        </span>
        <span className="goose-thinking__label">Thinking</span>
        {hasContent && (
          <span className="goose-thinking__chevron" aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
        )}
      </button>
      {expanded && hasContent && (
        <div className="goose-thinking__content">
          {thinkingText}
        </div>
      )}
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
    <div className="goose-thinking-block">
      <button
        className="goose-thinking-block__header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        type="button"
      >
        <span className="goose-thinking-block__icon" aria-hidden="true">💭</span>
        <span className="goose-thinking-block__title">Thought process</span>
        <span className="goose-thinking-block__chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <div className="goose-thinking-block__content">
          {text}
        </div>
      )}
    </div>
  );
};
