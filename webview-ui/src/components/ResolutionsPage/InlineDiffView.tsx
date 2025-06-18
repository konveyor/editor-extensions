import React from "react";
import { LocalChange } from "@editor-extensions/shared";
import "./inlineDiffView.css";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

interface InlineDiffViewProps {
  change: LocalChange;
  onClose: () => void;
}

export default function InlineDiffView({ change, onClose }: InlineDiffViewProps) {
  // Determine language based on file extension
  const getLanguage = (uri: string) => {
    const ext = uri.split(".").pop()?.toLowerCase();
    const languageMap: { [key: string]: string } = {
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      py: "python",
      java: "java",
      c: "c",
      cpp: "cpp",
      cs: "csharp",
      go: "go",
      rs: "rust",
      rb: "ruby",
      php: "php",
      swift: "swift",
      kt: "kotlin",
      scala: "scala",
      html: "html",
      css: "css",
      scss: "scss",
      less: "less",
      json: "json",
      xml: "xml",
      yaml: "yaml",
      yml: "yaml",
      md: "markdown",
      sh: "shell",
      bash: "shell",
      zsh: "shell",
      sql: "sql",
      vue: "vue",
      svelte: "svelte",
      astro: "astro",
    };
    return languageMap[ext || ""] || "plaintext";
  };

  // Format the diff for markdown display
  const formatDiffForMarkdown = (diff: string, language: string) => {
    // Clean up the diff to make it more readable
    const lines = diff.split("\n");
    let formattedDiff = "";
    let inHunk = false;

    for (const line of lines) {
      // Skip diff headers except for the file names
      if (line.startsWith("diff ")) {
        formattedDiff += "# " + line.substring(5) + "\n\n";
        continue;
      }

      if (line.startsWith("index ")) {
        continue;
      }

      if (line.startsWith("--- ") || line.startsWith("+++ ")) {
        continue;
      }

      // Start of a hunk
      if (line.startsWith("@@")) {
        inHunk = true;
        formattedDiff += "\n" + line + "\n";
        continue;
      }

      if (inHunk) {
        formattedDiff += line + "\n";
      }
    }

    // If no content was extracted, try to get file name for better error message
    if (!formattedDiff) {
      const fileName = (typeof change.originalUri === 'string' 
        ? change.originalUri 
        : change.originalUri.fsPath || '').split("/").pop() || "file";
      formattedDiff = `// No diff content available for ${fileName}`;
    }

    // Wrap in a code block with the appropriate language
    return "```diff\n" + formattedDiff + "\n```";
  };

  const filePath = typeof change.originalUri === 'string' 
    ? change.originalUri 
    : change.originalUri.fsPath || '';
  const language = getLanguage(filePath);
  const markdownContent = formatDiffForMarkdown(change.diff, language);
  console.log("markdownContent", markdownContent);
  console.log("language", language);
  console.log("change", change);
  console.log("change.diff", change.diff);
  console.log("change.originalUri", filePath);

  return (
    <div className="inline-diff-container">
      <div className="inline-diff-content">
        <ReactMarkdown
          className="markdown-diff"
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
}
