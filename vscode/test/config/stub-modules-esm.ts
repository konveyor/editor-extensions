// Alias modules loaded with import / type: module projects
import path from "node:path";
import url from "node:url";
import generateAliasesResolver from "esm-module-alias";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const aliases = {
  vscode: path.resolve(__dirname, "./stub-vscode.ts"),
};

export const resolve = generateAliasesResolver(aliases);
