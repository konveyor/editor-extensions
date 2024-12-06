import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import tsEslint from "typescript-eslint";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import prettier from "eslint-plugin-prettier";
import unusedImports from "eslint-plugin-unused-imports";
import react from "eslint-plugin-react";
import globals from "globals";
import eslint from "@eslint/js";

// Base configuration for all JavaScript files
const baseConfig = {
  plugins: {
    prettier,
    "unused-imports": unusedImports,
    react,
  },
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: "module",
    globals: {
      ...globals.es2023,
      ...globals.node,
      ...globals.mocha,
    },
  },
  rules: {
    curly: "warn",
    eqeqeq: "warn",
    "no-throw-literal": "warn",
    semi: "warn",
    "prettier/prettier": ["warn"],
    "unused-imports/no-unused-imports": ["warn"],
    "no-case-declarations": "warn",
    "no-extra-boolean-cast": "warn",
    "prefer-const": "warn",
    "@typescript-eslint/no-require-imports": "warn",
  },
  settings: {
    react: {
      version: "18.3.1",
    },
  },
};

// TypeScript-specific configuration
const tsConfig = {
  files: ["**/*.ts", "**/*.tsx"],
  plugins: {
    "@typescript-eslint": typescriptEslint,
  },
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
      projectService: true,
      tsconfigRootDir: ".",
    },
  },
  rules: {
    ...baseConfig.rules,
    "@typescript-eslint/naming-convention": [
      "warn",
      {
        selector: "import",
        format: ["camelCase", "PascalCase"],
      },
    ],
    "@typescript-eslint/no-require-imports": "warn",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/no-explicit-any": "off",
    "react/jsx-key": "warn",
    "react/no-unknown-property": ["warn"],
  },
};

export default [
  eslint.configs.recommended,
  ...tsEslint.configs.recommended,
  react.configs.flat.recommended,
  prettierRecommended,
  baseConfig,
  tsConfig,
  {
    ignores: [
      "**/dist/**",
      "**/out/**",
      "**/generated/**",
      "**/node_modules/**",
      "**/.git/**",
      "**/build/**",
      "**/.vscode-test/**",
      "**/.vscode/**",
    ],
  },
];
