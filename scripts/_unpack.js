import { dirname, join } from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import fs from "fs-extra";
import micromatch from "micromatch";
import * as tar from "tar";
import unzipper from "unzipper";
import { blue, bold, green, yellow } from "colorette";
import { isFile, isDirectory, chmodOwnerPlusX, relativeToCwd } from "./_util.js";

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

  const meta = {
    fileSetDirectory: relativeToCwd(targetDirectory),
    fileSet: [],
  };

  const matcher = micromatch.matcher(globs);
  try {
    await tar.extract({
      f: sourceFile,
      z: true,
      cwd: targetDirectory,
      filter: (path) => {
        const isMatch = matcher(path);
        if (isMatch) {
          meta.fileSet.push(path);
        }
        return isMatch;
      },
    });
  } catch (err) {
    throw new Error(`Could not unpack ${sourceFile}`, { cause: err });
  }
  return meta;
}

/**
 * @param {{
 *  sourceFile: string,
 *  context?: string,
 *  globs?: string[],
 *  targetDirectory: string
 * }} args
 */
export async function unpackZip({ sourceFile, context, globs = ["**/*"], targetDirectory }) {
  if (!(await isFile(sourceFile))) {
    throw new Error(`Source file does not exist: ${sourceFile}`);
  }
  if (!(await isDirectory(targetDirectory))) {
    throw new Error(`Destination path does not exist: ${targetDirectory}`);
  }

  const meta = {
    context,
    fileSetDirectory: relativeToCwd(targetDirectory),
    fileSet: [],
  };
  try {
    const matcher = micromatch.matcher(globs);
    const directory = await unzipper.Open.file(sourceFile);
    const files = directory.files.filter((file) =>
      context
        ? file.path.startsWith(context) && matcher(file.path.substring(context.length))
        : matcher(file.path),
    );
    for (const file of files) {
      // See: https://github.com/ZJONSSON/node-unzipper/blob/d19c3fb9c1bbdce6e6bcb701ac65ddb071e1eb31/lib/extract.js#L18-L40
      const contextFilePath = context ? file.path.substring(context.length) : file.path;
      const extractPath = join(targetDirectory, contextFilePath.replace(/\\/g, "/"));
      if (extractPath.indexOf(targetDirectory) !== 0) {
        continue;
      }
      if (file.type === "Directory") {
        await fs.ensureDir(extractPath);
      } else {
        await fs.ensureDir(dirname(extractPath));
        await pipeline(file.stream(), createWriteStream(extractPath));
      }
      meta.fileSet.push(file.path);
    }
  } catch (err) {
    throw new Error(`Could not unpack ${sourceFile}`, { cause: err });
  }
  return meta;
}

/**
 * @param {{
 *  sourceFile: string,
 *  context?: string,
 *  globs?: string[],
 *  targetDirectory: string,
 *  chmod: boolean,
 * }} args
 */
export async function unpackAsset({ sourceFile, context, globs, targetDirectory, chmod }) {
  let meta = {};
  console.group(bold("Unpacking:"), yellow(sourceFile));
  console.log("Destination:", targetDirectory);
  try {
    meta = await unpackZip({ sourceFile, context, globs, targetDirectory });
    console.log(`Extracted ${green(meta.fileSet.length)} items`);

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
  return meta;
}

/**
 * @param {{
 *  sourceDirectory: string,
 *  context?: string,
 *  globs?: string[],
 *  targetDirectory: function,
 *  assets: [{*}]
 * }} args
 */
export async function unpackAssets({
  title,
  sourceDirectory,
  context,
  globs,
  targetDirectory,
  assets,
}) {
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

      const assetMeta = await unpackAsset({
        sourceFile: source,
        targetDirectory: target,
        context,
        globs,
        chmod: asset.chmod,
      });

      meta.assets.push({
        ...asset,
        ...assetMeta,
      });
    }
  } finally {
    console.groupEnd();
  }
  return meta;
}
