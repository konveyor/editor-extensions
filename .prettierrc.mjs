/** @type {import("prettier").Config} */
const config = {
  // common default values -- explicitly stating our preferred config settings
  trailingComma: "all",
  semi: true,
  singleQuote: false,

  // Values used from .editorconfig:
  //   - printWidth == max_line_length
  //   - tabWidth == indent_size
  //   - useTabs == indent_style
  //   - endOfLine == end_of_line
};

export default config;
