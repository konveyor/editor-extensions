// Alias modules loaded with require / type: commonjs projects
import "module-alias/register";
import path from "node:path";
import { addAlias } from "module-alias";

addAlias("vscode", path.resolve(__dirname, "./stub-vscode.ts"));
