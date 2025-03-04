import { dirname, join } from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import fs from "fs-extra";
import micromatch from "micromatch";
import * as tar from "tar";
import unzipper from "unzipper";
import { blue, bold, green, yellow } from "colorette";
import { isFile, isDirectory, chmodOwnerPlusX } from "./_util.js";

/**
 * @param {{
 *  sourceFile: string,
 *  globs?: string[],
 *  targetDirectory: string
 * }} args
 */
export async function unpackTarGz({ sourceFile, globs = ["**/*"], targetDirectory }) {
  if (!(await isFile(sourceFile))) {
    throw new Error(`Source file does not exist: ${sourceFile}`);
  }
  if (!(await isDirectory(targetDirectory))) {
    throw new Error(`Destination path does not exist: ${targetDirectory}`);
  }

  const pathsExtracted = [];
  const matcher = micromatch.matcher(globs);
  try {
    await tar.extract({
      f: sourceFile,
      z: true,
      cwd: targetDirectory,
      filter: (path) => {
        const isMatch = matcher(path);
        if (isMatch) {
          pathsExtracted.push(path);
        }
        return isMatch;
      },
    });
  } catch (err) {
    throw new Error(`Could not unpack ${sourceFile}`, { cause: err });
  }
  return pathsExtracted;
}

/**
 * @param {{
 *  sourceFile: string,
 *  globs?: string[],
 *  targetDirectory: string
 * }} args
 */
export async function unpackZip({ sourceFile, globs = ["**/*"], targetDirectory }) {
  if (!(await isFile(sourceFile))) {
    throw new Error(`Source file does not exist: ${sourceFile}`);
  }
  if (!(await isDirectory(targetDirectory))) {
    throw new Error(`Destination path does not exist: ${targetDirectory}`);
  }

  const pathsExtracted = [];
  try {
    const matcher = micromatch.matcher(globs);
    const directory = await unzipper.Open.file(sourceFile);
    for (const file of directory.files.filter((file) => matcher(file.path))) {
      // See: https://github.com/ZJONSSON/node-unzipper/blob/d19c3fb9c1bbdce6e6bcb701ac65ddb071e1eb31/lib/extract.js#L18-L40
      const extractPath = join(targetDirectory, file.path.replace(/\\/g, "/"));
      if (extractPath.indexOf(targetDirectory) !== 0) {
        continue;
      }
      if (file.type === "Directory") {
        await fs.ensureDir(extractPath);
      } else {
        await fs.ensureDir(dirname(extractPath));
        await pipeline(file.stream(), createWriteStream(extractPath));
      }
      pathsExtracted.push(file.path);
    }
  } catch (err) {
    throw new Error(`Could not unpack ${sourceFile}`, { cause: err });
  }
  return pathsExtracted;
}

/**
 * @param {{
 *  sourceFile: string,
 *  globs?: string[],
 *  targetDirectory: string,
 *  chmod: boolean,
 * }} args
 */
export async function unpackAsset({ sourceFile, globs, targetDirectory, chmod }) {
  let pathsExtracted = [];
  console.group(bold("Unpacking:"), yellow(sourceFile));
  console.log("Destination:", targetDirectory);
  try {
    pathsExtracted = await unpackZip({ sourceFile, globs, targetDirectory });
    console.log(`Extracted ${green(pathsExtracted.length)} items`);

    if (chmod) {
      const extractedFiles = await fs.readdir(targetDirectory);
      for (const file of extractedFiles) {
        console.log(`chmod o+x ${blue(file)}`);
        chmodOwnerPlusX(join(targetDirectory, file));
      }
    }
  } finally {
    console.groupEnd();
  }
  return pathsExtracted;
}

/**
 * @param {{
 *  sourceDirectory: string,
 *  globs?: string[],
 *  targetDirectory: function,
 *  assets: [{*}]
 * }} args
 */
export async function unpackAssets({ title, sourceDirectory, globs, targetDirectory, assets }) {
  if (!(await isDirectory(sourceDirectory))) {
    throw new Error(`Source directory does not exist: ${sourceDirectory}`);
  }

  const meta = { assets: [] };
  console.group(`${title} - Unpacking ${assets.length} assets:`);
  try {
    for (const asset of assets) {
      const source = join(sourceDirectory, asset.name);
      const target = targetDirectory(asset);
      await fs.ensureDir(target);

      const pathsExtracted = await unpackAsset({
        sourceFile: source,
        targetDirectory: target,
        globs,
        chmod: asset.chmod,
      });

      meta.assets.push({
        ...asset,
        fileSetDirectory: target,
        fileSet: pathsExtracted,
      });
    }
  } finally {
    console.groupEnd();
  }
  return meta;
}
