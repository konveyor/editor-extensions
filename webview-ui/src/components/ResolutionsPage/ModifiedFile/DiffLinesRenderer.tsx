import React from "react";
import hljs from "highlight.js";
import { getLanguageFromExtension } from "../../../../../shared/src/utils/languageMapping";

interface DiffLinesRendererProps {
  diffContent: string;
  filePath: string;
}

export const DiffLinesRenderer: React.FC<DiffLinesRendererProps> = ({ diffContent, filePath }) => {
  // Helper function to parse and render diff lines with syntax highlighting
  const renderDiffLines = (diffContent: string) => {
    if (!diffContent) {
      return <div className="diff-line context">No diff content available</div>;
    }

    const lines = diffContent.split("\n");
    return lines.map((line, index) => {
      let lineClass = "context";
      let lineNumber = "";
      let content = line;
      let shouldHighlight = false;

      if (line.startsWith("+")) {
        lineClass = "addition";
        lineNumber = "  +";
        content = line.substring(1);
        shouldHighlight = true;
      } else if (line.startsWith("-")) {
        lineClass = "deletion";
        lineNumber = "  -";
        content = line.substring(1);
        shouldHighlight = true;
      } else if (line.startsWith("@@")) {
        lineClass = "meta";
        lineNumber = "  ";
        content = line;
        shouldHighlight = false;
      } else if (
        line.startsWith("diff ") ||
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ")
      ) {
        lineClass = "meta";
        lineNumber = "  ";
        content = line;
        shouldHighlight = false;
      } else if (line.match(/^\d+$/)) {
        // Line numbers
        lineClass = "meta";
        lineNumber = line.padStart(3);
        content = "";
        shouldHighlight = false;
      } else if (line.startsWith(" ")) {
        lineClass = "context";
        lineNumber = "   ";
        content = line.substring(1);
        shouldHighlight = true;
      }

      // Apply syntax highlighting to code content
      let highlightedContent = content;
      if (shouldHighlight && content.trim()) {
        try {
          const fileExtension = filePath.split(".").pop()?.toLowerCase() || "";
          let language = getLanguageFromExtension(fileExtension);

          // Map common file extensions to highlight.js languages
          const languageMap: Record<string, string> = {
            js: "javascript",
            ts: "typescript",
            jsx: "javascript",
            tsx: "typescript",
            java: "java",
            py: "python",
            css: "css",
            html: "html",
            xml: "xml",
            json: "json",
            yaml: "yaml",
            yml: "yaml",
            properties: "properties",
            gradle: "groovy",
            groovy: "groovy",
            pom: "xml",
            md: "markdown",
          };

          language = languageMap[fileExtension] || language;

          if (language && language !== "text" && hljs.getLanguage(language)) {
            const highlighted = hljs.highlight(content, { language });
            highlightedContent = highlighted.value;
          }
        } catch {
          // Fallback to plain text if highlighting fails
          highlightedContent = content;
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
