import process from "node:process";
import path from "node:path";
import fs from "node:fs";

import { italic, gray } from "colorette";

/**
 * Change the process's cwd to the project root (as per the normal location of this file).
 */
export function cwdToProjectRoot() {
  const getProjectRoot = path.resolve(path.dirname(process.argv[1]), "..");
  process.chdir(getProjectRoot);
  console.log(gray(italic(`working from: ${getProjectRoot}`)));
}

/**
 * `chmod` a file or directory to add owner execute permissions.  Same as
 * running `chmod o+x {path}`.
 *
 * @param {string} path File or directory to chmod
 */
export function chmodOwnerPlusX(path) {
  const { mode = fs.constants.S_IRUSR } = fs.statSync(path);
  fs.chmodSync(path, mode | fs.constants.S_IXUSR);
}
