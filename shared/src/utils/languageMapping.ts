// Language mapping for syntax highlighting - shared across components
export const LANGUAGE_MAP: { [key: string]: string } = {
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

/**
 * Gets the VS Code language identifier from a file extension
 * @param extension The file extension (without the dot)
 * @returns The corresponding VS Code language identifier or "plaintext" if not found
 */
export function getLanguageFromExtension(extension: string): string {
  return LANGUAGE_MAP[extension.toLowerCase()] || "plaintext";
}
