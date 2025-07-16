/**
 * Enhanced syntax highlighting theme integration for VS Code
 * Provides better color scheme mapping and theme awareness
 */

export interface SyntaxTheme {
  name: string;
  type: "light" | "dark" | "high-contrast";
  colors: {
    // Base colors
    background: string;
    foreground: string;

    // Syntax highlighting colors
    keyword: string;
    string: string;
    comment: string;
    number: string;
    function: string;
    variable: string;
    type: string;
    operator: string;
    punctuation: string;
    constant: string;
    property: string;

    // Diff colors
    additionBackground: string;
    additionForeground: string;
    deletionBackground: string;
    deletionForeground: string;
    metaBackground: string;
    metaForeground: string;

    // Line numbers and gutter
    lineNumber: string;
    lineNumberActive: string;
    gutter: string;
  };
}

// Default themes that work well with VS Code
export const DEFAULT_THEMES: { [key: string]: SyntaxTheme } = {
  dark: {
    name: "Dark (Visual Studio)",
    type: "dark",
    colors: {
      background: "#1e1e1e",
      foreground: "#d4d4d4",

      keyword: "#569cd6",
      string: "#ce9178",
      comment: "#6a9955",
      number: "#b5cea8",
      function: "#dcdcaa",
      variable: "#9cdcfe",
      type: "#4ec9b0",
      operator: "#d4d4d4",
      punctuation: "#d4d4d4",
      constant: "#4fc1ff",
      property: "#9cdcfe",

      additionBackground: "rgba(34, 134, 58, 0.15)",
      additionForeground: "#22863a",
      deletionBackground: "rgba(203, 36, 49, 0.15)",
      deletionForeground: "#cb2431",
      metaBackground: "rgba(106, 115, 125, 0.1)",
      metaForeground: "#6a737d",

      lineNumber: "#858585",
      lineNumberActive: "#c6c6c6",
      gutter: "#2f2f2f",
    },
  },

  light: {
    name: "Light (Visual Studio)",
    type: "light",
    colors: {
      background: "#ffffff",
      foreground: "#000000",

      keyword: "#0000ff",
      string: "#a31515",
      comment: "#008000",
      number: "#098658",
      function: "#795e26",
      variable: "#001080",
      type: "#267f99",
      operator: "#000000",
      punctuation: "#000000",
      constant: "#0070c1",
      property: "#001080",

      additionBackground: "rgba(34, 134, 58, 0.1)",
      additionForeground: "#22863a",
      deletionBackground: "rgba(203, 36, 49, 0.1)",
      deletionForeground: "#cb2431",
      metaBackground: "rgba(106, 115, 125, 0.1)",
      metaForeground: "#6a737d",

      lineNumber: "#237893",
      lineNumberActive: "#0b216f",
      gutter: "#f5f5f5",
    },
  },

  "high-contrast": {
    name: "High Contrast",
    type: "high-contrast",
    colors: {
      background: "#000000",
      foreground: "#ffffff",

      keyword: "#00ffff",
      string: "#00ff00",
      comment: "#7ca668",
      number: "#00ff00",
      function: "#ffff00",
      variable: "#ffffff",
      type: "#00ffff",
      operator: "#ffffff",
      punctuation: "#ffffff",
      constant: "#00ffff",
      property: "#ffffff",

      additionBackground: "rgba(0, 255, 0, 0.2)",
      additionForeground: "#00ff00",
      deletionBackground: "rgba(255, 0, 0, 0.2)",
      deletionForeground: "#ff0000",
      metaBackground: "rgba(255, 255, 255, 0.1)",
      metaForeground: "#ffffff",

      lineNumber: "#ffffff",
      lineNumberActive: "#ffff00",
      gutter: "#000000",
    },
  },
};

/**
 * Generate CSS custom properties for a theme
 */
export function generateThemeCSS(theme: SyntaxTheme): string {
  return `
    :root {
      --syntax-bg: ${theme.colors.background};
      --syntax-fg: ${theme.colors.foreground};
      --syntax-keyword: ${theme.colors.keyword};
      --syntax-string: ${theme.colors.string};
      --syntax-comment: ${theme.colors.comment};
      --syntax-number: ${theme.colors.number};
      --syntax-function: ${theme.colors.function};
      --syntax-variable: ${theme.colors.variable};
      --syntax-type: ${theme.colors.type};
      --syntax-operator: ${theme.colors.operator};
      --syntax-punctuation: ${theme.colors.punctuation};
      --syntax-constant: ${theme.colors.constant};
      --syntax-property: ${theme.colors.property};
      
      --diff-addition-bg: ${theme.colors.additionBackground};
      --diff-addition-fg: ${theme.colors.additionForeground};
      --diff-deletion-bg: ${theme.colors.deletionBackground};
      --diff-deletion-fg: ${theme.colors.deletionForeground};
      --diff-meta-bg: ${theme.colors.metaBackground};
      --diff-meta-fg: ${theme.colors.metaForeground};
      
      --line-number: ${theme.colors.lineNumber};
      --line-number-active: ${theme.colors.lineNumberActive};
      --gutter: ${theme.colors.gutter};
    }
  `;
}

/**
 * Detect current VS Code theme type
 */
export function detectVSCodeTheme(): "light" | "dark" | "high-contrast" {
  // Check for VS Code theme classes
  if (document.documentElement.classList.contains("vscode-high-contrast")) {
    return "high-contrast";
  }
  if (document.documentElement.classList.contains("vscode-dark")) {
    return "dark";
  }

  // Check for PatternFly theme classes
  if (document.documentElement.classList.contains("pf-v6-theme-dark")) {
    return "dark";
  }

  // Fallback to system preference
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

/**
 * Get the appropriate theme for current VS Code environment
 */
export function getCurrentTheme(): SyntaxTheme {
  const themeType = detectVSCodeTheme();
  return DEFAULT_THEMES[themeType];
}

/**
 * Apply theme to the document
 */
export function applyTheme(theme?: SyntaxTheme): void {
  const selectedTheme = theme || getCurrentTheme();
  const css = generateThemeCSS(selectedTheme);

  // Remove existing theme style
  const existingStyle = document.getElementById("syntax-highlighting-theme");
  if (existingStyle) {
    existingStyle.remove();
  }

  // Add new theme style
  const style = document.createElement("style");
  style.id = "syntax-highlighting-theme";
  style.textContent = css;
  document.head.appendChild(style);
}

/**
 * Enhanced highlight.js theme configuration
 */
export function getHighlightJSTheme(theme?: SyntaxTheme): any {
  const selectedTheme = theme || getCurrentTheme();

  return {
    "hljs-keyword": { color: selectedTheme.colors.keyword },
    "hljs-string": { color: selectedTheme.colors.string },
    "hljs-comment": { color: selectedTheme.colors.comment, fontStyle: "italic" },
    "hljs-number": { color: selectedTheme.colors.number },
    "hljs-function": { color: selectedTheme.colors.function },
    "hljs-variable": { color: selectedTheme.colors.variable },
    "hljs-type": { color: selectedTheme.colors.type },
    "hljs-operator": { color: selectedTheme.colors.operator },
    "hljs-punctuation": { color: selectedTheme.colors.punctuation },
    "hljs-literal": { color: selectedTheme.colors.constant },
    "hljs-property": { color: selectedTheme.colors.property },
    "hljs-attr": { color: selectedTheme.colors.property },
    "hljs-title": { color: selectedTheme.colors.function },
    "hljs-built_in": { color: selectedTheme.colors.type },
    "hljs-class": { color: selectedTheme.colors.type },
    "hljs-tag": { color: selectedTheme.colors.keyword },
    "hljs-name": { color: selectedTheme.colors.keyword },
    "hljs-selector-tag": { color: selectedTheme.colors.keyword },
    "hljs-selector-class": { color: selectedTheme.colors.type },
    "hljs-selector-id": { color: selectedTheme.colors.constant },
  };
}

/**
 * Watch for theme changes and auto-update
 */
export function watchThemeChanges(callback?: (theme: SyntaxTheme) => void): () => void {
  let currentThemeType = detectVSCodeTheme();

  const observer = new MutationObserver(() => {
    const newThemeType = detectVSCodeTheme();
    if (newThemeType !== currentThemeType) {
      currentThemeType = newThemeType;
      const newTheme = getCurrentTheme();
      applyTheme(newTheme);
      callback?.(newTheme);
    }
  });

  // Watch for class changes on document element
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  // Watch for media query changes
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const mediaQueryHandler = () => {
    const newThemeType = detectVSCodeTheme();
    if (newThemeType !== currentThemeType) {
      currentThemeType = newThemeType;
      const newTheme = getCurrentTheme();
      applyTheme(newTheme);
      callback?.(newTheme);
    }
  };

  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener("change", mediaQueryHandler);
  } else {
    // Fallback for older browsers
    mediaQuery.addListener(mediaQueryHandler);
  }

  // Return cleanup function
  return () => {
    observer.disconnect();
    if (mediaQuery.removeEventListener) {
      mediaQuery.removeEventListener("change", mediaQueryHandler);
    } else {
      // Fallback for older browsers
      mediaQuery.removeListener(mediaQueryHandler);
    }
  };
}
