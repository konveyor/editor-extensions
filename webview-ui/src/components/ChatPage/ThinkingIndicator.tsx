import React from "react";

export const ThinkingIndicator: React.FC = () => {
  return (
    <div className="goose-thinking" aria-label="Thinking">
      <span className="goose-thinking__dot" />
      <span className="goose-thinking__dot" />
      <span className="goose-thinking__dot" />
      <span className="goose-thinking__label">Thinking</span>
    </div>
  );
};
