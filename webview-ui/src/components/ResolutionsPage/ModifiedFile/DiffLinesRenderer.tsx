import React, { useEffect } from "react";
import hljs from "highlight.js";
import { detectLanguage, isLanguageSupported } from "@editor-extensions/shared";
import { applyTheme, watchThemeChanges } from "../../../utils/syntaxHighlightingTheme";

// Re-enabling CSS import to test if this breaks re-rendering
import "./enhancedSyntaxHighlighting.css";

interface DiffLinesRendererProps {
  diffContent: string;
  filePath: string;
  content?: string; // Optional full file content for better language detection
}

export const DiffLinesRenderer: React.FC<DiffLinesRendererProps> = ({
  diffContent,
  filePath,
  content,
}) => {
  // Re-enabling theme application to confirm this breaks re-rendering
  useEffect(() => {
    applyTheme();
    const cleanup = watchThemeChanges();
    return cleanup;
  }, []);

  // Helper function to parse and render diff lines with enhanced syntax highlighting
  const renderDiffLines = (diffContent: string) => {
    if (!diffContent) {
      return <div className="diff-line context">No diff content available</div>;
    }

    // Re-enable enhanced language detection
    const detectedLanguage = detectLanguage(filePath, content);
    const shouldHighlight = isLanguageSupported(detectedLanguage);

    const lines = diffContent.split("\n");
    return lines.map((line, index) => {
      let lineClass = "context";
      let lineNumber = "";
      let content = line;
      let shouldHighlightLine = false;

      if (line.startsWith("+")) {
        lineClass = "addition";
        lineNumber = "  +";
        content = line.substring(1);
        shouldHighlightLine = shouldHighlight;
      } else if (line.startsWith("-")) {
        lineClass = "deletion";
        lineNumber = "  -";
        content = line.substring(1);
        shouldHighlightLine = shouldHighlight;
      } else if (line.startsWith("@@")) {
        lineClass = "meta";
        lineNumber = "  ";
        content = line;
        shouldHighlightLine = false;
      } else if (
        line.startsWith("diff ") ||
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ")
      ) {
        lineClass = "meta";
        lineNumber = "  ";
        content = line;
        shouldHighlightLine = false;
      } else if (line.match(/^\d+$/)) {
        // Line numbers
        lineClass = "meta";
        lineNumber = line.padStart(3);
        content = "";
        shouldHighlightLine = false;
      } else if (line.startsWith(" ")) {
        lineClass = "context";
        lineNumber = "   ";
        content = line.substring(1);
        shouldHighlightLine = shouldHighlight;
      }

      // Apply enhanced syntax highlighting
      let highlightedContent = content;
      if (shouldHighlightLine && content.trim() && detectedLanguage !== "plaintext") {
        try {
          const highlighted = hljs.highlight(content, {
            language: detectedLanguage,
            ignoreIllegals: true,
          });
          highlightedContent = highlighted.value;
        } catch {
          // If highlighting fails, try auto-detection as fallback
          try {
            const autoHighlighted = hljs.highlightAuto(content);
            if (autoHighlighted.relevance > 5) {
              // Only use if confidence is high
              highlightedContent = autoHighlighted.value;
            }
          } catch {
            // Final fallback to plain text
            highlightedContent = content;
          }
        }
      }

      return (
        <div key={index} className={`diff-line ${lineClass}`}>
          <span className="diff-line-number">{lineNumber}</span>
          <span className="diff-content" dangerouslySetInnerHTML={{ __html: highlightedContent }} />
        </div>
      );
    });
  };

  return <>{renderDiffLines(diffContent)}</>;
};
