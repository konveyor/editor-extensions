import path from "path";
import fs from "fs";
import { access } from "node:fs/promises";
import { platform } from "node:process";

const isWindows = platform === "win32";

export const checkIfExecutable = async (filePath: string): Promise<boolean> => {
  try {
    // Normalize the path for cross-platform compatibility
    const normalizedPath = path.normalize(filePath);

    if (isWindows) {
      // On Windows, check if the file has a valid executable extension
      const executableExtensions = [".exe"];
      const fileExtension = path.extname(normalizedPath).toLowerCase();

      if (!executableExtensions.includes(fileExtension)) {
        console.warn(`File does not have a valid Windows executable extension: ${normalizedPath}`);
        return false;
      }
    } else {
      // On Unix systems, check for execute permissions
      await access(normalizedPath, fs.constants.X_OK);
    }

    // Check if the file exists
    await access(normalizedPath, fs.constants.F_OK);
    return true;
  } catch (err) {
    console.error("Error checking if file is executable:", err);
    return false;
  }
};
