// Enhanced language mapping for syntax highlighting - shared across components
export const LANGUAGE_MAP: { [key: string]: string } = {
  // JavaScript & TypeScript
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mjs: "javascript",
  cjs: "javascript",

  // Python
  py: "python",
  pyx: "python",
  pyi: "python",

  // Java & JVM Languages
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  groovy: "groovy",
  gradle: "groovy",

  // C/C++
  c: "c",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  h: "c",
  hpp: "cpp",
  hxx: "cpp",

  // C#
  cs: "csharp",
  csx: "csharp",

  // Web Languages
  html: "html",
  htm: "html",
  xhtml: "html",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  stylus: "stylus",

  // Modern Web Frameworks
  vue: "vue",
  svelte: "svelte",
  astro: "astro",

  // Other Popular Languages
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  swift: "swift",
  dart: "dart",
  lua: "lua",
  r: "r",

  // Markup & Data
  json: "json",
  json5: "json",
  jsonc: "json",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  properties: "properties",

  // Documentation
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",

  // Shell & Scripts
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "powershell",
  psm1: "powershell",

  // Database
  sql: "sql",
  mysql: "sql",
  pgsql: "sql",
  sqlite: "sql",

  // Configuration & Infrastructure
  dockerfile: "dockerfile",
  docker: "dockerfile",
  tf: "hcl",
  hcl: "hcl",
  nomad: "hcl",
  packer: "hcl",

  // Build Files
  makefile: "makefile",
  mk: "makefile",
  cmake: "cmake",

  // Functional Languages
  hs: "haskell",
  elm: "elm",
  ml: "ocaml",
  fs: "fsharp",
  clj: "clojure",
  cljs: "clojure",

  // Assembly & Low Level
  asm: "x86asm",
  s: "x86asm",

  // Version Control
  diff: "diff",
  patch: "diff",

  // Template Languages
  handlebars: "handlebars",
  hbs: "handlebars",
  mustache: "handlebars",

  // Game Development
  gd: "gdscript", // Godot

  // Mobile Development
  m: "objectivec",
  mm: "objectivec",
};

// File patterns for special cases where extension isn't enough
export const FILE_PATTERN_MAP: { [pattern: string]: string } = {
  // Build files
  "pom.xml": "xml",
  "build.gradle": "groovy",
  "build.gradle.kts": "kotlin",
  "package.json": "json",
  "package-lock.json": "json",
  "yarn.lock": "yaml",
  "composer.json": "json",
  "Cargo.toml": "toml",
  "go.mod": "go-mod",
  "go.sum": "go-mod",

  // Configuration files
  "webpack.config.js": "javascript",
  "vite.config.js": "javascript",
  "rollup.config.js": "javascript",
  "babel.config.js": "javascript",
  "eslint.config.js": "javascript",
  "tsconfig.json": "json",
  "jest.config.js": "javascript",
  "tailwind.config.js": "javascript",

  // Environment & deployment
  ".env": "properties",
  ".env.local": "properties",
  ".env.production": "properties",
  Dockerfile: "dockerfile",
  "docker-compose.yml": "yaml",
  "docker-compose.yaml": "yaml",

  // CI/CD
  ".github/workflows/*.yml": "yaml",
  ".github/workflows/*.yaml": "yaml",
  ".gitlab-ci.yml": "yaml",
  "azure-pipelines.yml": "yaml",
  Jenkinsfile: "groovy",

  // Special files
  Makefile: "makefile",
  "CMakeLists.txt": "cmake",
  Podfile: "ruby",
  Gemfile: "ruby",
  Rakefile: "ruby",
};

// Content-based language detection patterns
export const CONTENT_PATTERNS: { pattern: RegExp; language: string }[] = [
  // Shebang patterns
  { pattern: /^#!\s*\/.*\/node/, language: "javascript" },
  { pattern: /^#!\s*\/.*\/python/, language: "python" },
  { pattern: /^#!\s*\/.*\/ruby/, language: "ruby" },
  { pattern: /^#!\s*\/.*\/php/, language: "php" },
  { pattern: /^#!\s*\/.*\/(bash|sh|zsh)/, language: "shell" },

  // Language-specific patterns
  { pattern: /^\s*<\?php/, language: "php" },
  { pattern: /^\s*<!DOCTYPE\s+html/i, language: "html" },
  { pattern: /^\s*<html/i, language: "html" },
  { pattern: /^\s*package\s+\w+\s*;/, language: "java" },
  { pattern: /^\s*import\s+(?:java\.|javax\.|org\.)/m, language: "java" },
  { pattern: /^\s*using\s+System/, language: "csharp" },
  { pattern: /^\s*namespace\s+\w+/, language: "csharp" },
  { pattern: /^\s*#include\s*</, language: "cpp" },
  { pattern: /^\s*import\s+React/m, language: "javascript" },
];

/**
 * Enhanced language detection from file extension
 */
export function getLanguageFromExtension(extension: string): string {
  const ext = extension.toLowerCase();
  return LANGUAGE_MAP[ext] || "plaintext";
}

/**
 * Get language from full filename (handles special files)
 */
export function getLanguageFromFilename(filename: string): string {
  const fullName = filename.toLowerCase();

  // Check exact filename matches first
  for (const [pattern, language] of Object.entries(FILE_PATTERN_MAP)) {
    if (pattern.includes("*")) {
      // Handle wildcard patterns
      const regex = new RegExp(pattern.replace(/\*/g, ".*"));
      if (regex.test(fullName)) {
        return language;
      }
    } else if (fullName.endsWith(pattern.toLowerCase()) || fullName === pattern.toLowerCase()) {
      return language;
    }
  }

  // Fall back to extension-based detection
  const extension = filename.split(".").pop();
  return extension ? getLanguageFromExtension(extension) : "plaintext";
}

/**
 * Detect language from file content (for ambiguous cases)
 */
export function detectLanguageFromContent(
  content: string,
  fallbackLanguage: string = "plaintext",
): string {
  if (!content || content.trim().length === 0) {
    return fallbackLanguage;
  }

  // Check first few lines for patterns
  const firstLines = content.split("\n").slice(0, 10).join("\n");

  for (const { pattern, language } of CONTENT_PATTERNS) {
    if (pattern.test(firstLines)) {
      return language;
    }
  }

  return fallbackLanguage;
}

/**
 * Comprehensive language detection combining all methods
 */
export function detectLanguage(filepath: string, content?: string): string {
  // 1. Try filename-based detection first (most reliable)
  const filenameLanguage = getLanguageFromFilename(filepath);
  if (filenameLanguage !== "plaintext") {
    return filenameLanguage;
  }

  // 2. If we have content, try content-based detection
  if (content) {
    const contentLanguage = detectLanguageFromContent(content, "plaintext");
    if (contentLanguage !== "plaintext") {
      return contentLanguage;
    }
  }

  // 3. Fall back to extension-based detection
  const extension = filepath.split(".").pop();
  if (extension) {
    return getLanguageFromExtension(extension);
  }

  return "plaintext";
}

/**
 * Check if a language is supported by highlight.js
 */
export function isLanguageSupported(language: string): boolean {
  // These are the languages commonly supported by highlight.js
  const supportedLanguages = new Set([
    "javascript",
    "typescript",
    "python",
    "java",
    "cpp",
    "c",
    "csharp",
    "go",
    "rust",
    "ruby",
    "php",
    "swift",
    "kotlin",
    "scala",
    "groovy",
    "html",
    "css",
    "scss",
    "less",
    "json",
    "xml",
    "yaml",
    "markdown",
    "shell",
    "sql",
    "dockerfile",
    "makefile",
    "haskell",
    "elm",
    "clojure",
    "lua",
    "dart",
    "r",
    "diff",
    "properties",
    "powershell",
    "x86asm",
    "objectivec",
    "handlebars",
    "stylus",
    "toml",
    "ini",
    "vue",
    "svelte",
    "astro",
    "ocaml",
    "fsharp",
    "gdscript",
    "hcl",
    "cmake",
  ]);

  return supportedLanguages.has(language);
}

/**
 * Get display name for a language
 */
export function getLanguageDisplayName(language: string): string {
  const displayNames: { [key: string]: string } = {
    javascript: "JavaScript",
    typescript: "TypeScript",
    cpp: "C++",
    csharp: "C#",
    html: "HTML",
    css: "CSS",
    scss: "SCSS",
    less: "LESS",
    json: "JSON",
    xml: "XML",
    yaml: "YAML",
    markdown: "Markdown",
    shell: "Shell",
    sql: "SQL",
    dockerfile: "Dockerfile",
    makefile: "Makefile",
    x86asm: "Assembly",
    objectivec: "Objective-C",
    powershell: "PowerShell",
    plaintext: "Plain Text",
  };

  return displayNames[language] || language.charAt(0).toUpperCase() + language.slice(1);
}
