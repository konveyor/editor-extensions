import { join } from "path";
import { readFileSync } from "fs";

export const KONVEYOR_SCHEME = "konveyorMemFs";
export const KONVEYOR_READ_ONLY_SCHEME = "konveyorReadOnly";
export const RULE_SET_DATA_FILE_PREFIX = "analysis";
export const PARTIAL_RULE_SET_DATA_FILE_PREFIX = "partial_analysis";
export const MERGED_RULE_SET_DATA_FILE_PREFIX = "merged_analysis";
export const SOLUTION_DATA_FILE_PREFIX = "solution";

const packagePath = join(__dirname, "..", "..", "package.json");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
export const EXTENSION_NAME = packageJson.name;
