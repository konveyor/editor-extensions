import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { getLanguageFromExtension, filterLineEndingOnlyChanges } from "@editor-extensions/shared";

interface ModifiedFileDiffPreviewProps {
  diff: string;
  path: string;
}

export const ModifiedFileDiffPreview: React.FC<ModifiedFileDiffPreviewProps> = ({ diff, path }) => {
  const getLanguage = (filePath: string): string => {
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    return getLanguageFromExtension(ext);
  };

  const formatDiffForMarkdown = (diffContent: string, fileName: string) => {
    try {
      const lines = diffContent.split("\n");

      // Filter out line-ending-only changes
      const filteredLines = filterLineEndingOnlyChanges(lines);

      let formattedDiff = "";
      let inHunk = false;

      for (const line of filteredLines) {
        if (line.startsWith("diff ")) {
          formattedDiff += "# " + line.substring(5) + "\n\n";
          continue;
        }

        if (line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
          continue;
        }

        if (line.startsWith("@@")) {
          inHunk = true;
          formattedDiff += "\n" + line + "\n";
          continue;
        }

        if (inHunk) {
          formattedDiff += line + "\n";
        }
      }

      if (!formattedDiff) {
        formattedDiff = `// No meaningful diff content available for ${fileName}`;
      }

      return "```diff\n" + formattedDiff + "\n```";
    } catch {
      return `\`\`\`\n// Error parsing diff content for ${fileName}\n\`\`\``;
    }
  };

  const language = getLanguage(path);
  const fileName =
    path && typeof path === "string" && path.trim() !== ""
      ? path.split("/").pop() || path
      : "Unnamed File";
  const markdownContent = formatDiffForMarkdown(diff, fileName);

  return (
    <div className="modified-file-diff">
      <div className="markdown-diff">
        <ReactMarkdown
          rehypePlugins={[
            rehypeRaw,
            rehypeSanitize,
            [
              rehypeHighlight,
              {
                ignoreMissing: true,
                detect: true,
                language: language,
              },
            ],
          ]}
        >
          {markdownContent}
        </ReactMarkdown>
      </div>
    </div>
  );
};

export default ModifiedFileDiffPreview;
