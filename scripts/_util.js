import process from "node:process";
import path from "node:path";
import { italic, gray } from "colorette";

export function cwdToProjectRoot() {
  const getProjectRoot = path.resolve(path.dirname(process.argv[1]), "..");
  process.chdir(getProjectRoot);
  console.log(gray(italic(`working from: ${getProjectRoot}`)));
}
