import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import tsEslint from "typescript-eslint";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import prettier from "eslint-plugin-prettier";
import unusedImports from "eslint-plugin-unused-imports";
import react from "eslint-plugin-react";
import globals from "globals";
import eslint from "@eslint/js";

export default [
  eslint.configs.recommended,
  ...tsEslint.configs.recommended,
  react.configs.flat.recommended,
  prettierRecommended,
  {
    files: ["**/*.js", "**/*.jsx", "**/*.cjs", "**/*.mjs", "**/*.ts", "**/*.tsx"],
  },
  {
    plugins: {
      "@typescript-eslint": typescriptEslint,
      prettier,
      "unused-imports": unusedImports,
      react,
    },

    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023, // keep in sync with tsconfig.json
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.es2023,
        ...globals.node,
        myCustomGlobal: "readonly",
      },
    },

    rules: {
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],

      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      semi: "warn",

      "prettier/prettier": ["warn"],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "unused-imports/no-unused-imports": ["warn"],
      "no-case-declarations": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "react/jsx-key": "warn",
      // "react-hooks/rules-of-hooks": "warn",
      // "react-hooks/exhaustive-deps": "warn",
      "no-extra-boolean-cast": "warn",
      "prefer-const": "warn",
      "react/no-unknown-property": ["warn"],
    },

    settings: {
      react: { version: "detect" },
    },

    ignores: [
      // take the place of `.eslintignore`
      "dist/",
      "out/",
      "generated/",
      "node_modules/",
    ],
  },
];
