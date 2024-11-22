import util from "node:util";
import path from "node:path";

import fs from "fs-extra";
import { globby } from "globby";
import { bold, green, yellow } from "colorette";

// These are a simplified version of rollup-plugin-copy (https://github.com/vladshcherbin/rollup-plugin-copy)
function stringify(value) {
  return util.inspect(value, { breakLength: Infinity });
}

async function isFile(filePath) {
  const fileStats = await fs.stat(filePath);
  return fileStats.isFile();
}

async function isDirectory(filePath) {
  const fileStats = await fs.stat(filePath);
  return fileStats.isDirectory();
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

/**
 * Get a target ready for globby by following the same basic context/src
 * conversion rules as `copy-webpack-plugin`.
 *
 * Ref: https://github.com/webpack-contrib/copy-webpack-plugin/blob/master/README.md#different-variants-of-from-glob-file-or-dir
 */
async function normalizeTarget({ context, src, ...rest }) {
  const result = { ...rest };

  if (context) {
    result.context = context;
    result.src = src;
  } else if (await isFile(src)) {
    result.context = path.dirname(src);
    result.src = path.basename(src);
  } else if (await isDirectory(src)) {
    result.context = src;
    result.src = "**/*";
  } else {
    result.context = ".";
    result.src = src;
  }

  return result;
}

async function generateCopyTarget(context, src, dest, { transform }) {
  if (transform && !(await isFile(src))) {
    throw new Error(`"transform" option works only on files: '${src}' must be a file`);
  }

  const { base, dir } = path.parse(src);
  const srcPath = path.join(context, src);
  const destPath = path.join(dest, dir, base);
  const destContents = transform && (await transform(await fs.readFile(srcPath), base));

  return {
    src: srcPath,
    dest: destPath,
    ...(destContents && { contents: destContents }),
    transformed: transform,
  };
}

export default async function copy({ targets = [], verbose = false }) {
  const copyTargets = [];

  if (Array.isArray(targets) && targets.length) {
    for (const target of targets) {
      if (!isObject(target)) {
        throw new Error(`${stringify(target)} target must be an object`);
      }

      if (!target.src || !target.dest) {
        throw new Error(`${stringify(target)} target must have "src" and "dest" properties`);
      }

      const { dest, src, context, transform } = await normalizeTarget(target);

      const matchedPaths = await globby(src, {
        cwd: context,
        expandDirectories: false,
        onlyFiles: true,
      });

      if (matchedPaths.length) {
        for (const matchedPath of matchedPaths) {
          copyTargets.push(await generateCopyTarget(context, matchedPath, dest, { transform }));
        }
      }
    }
  }

  if (copyTargets.length) {
    if (verbose) {
      console.log(green("copied:"));
    }

    for (const copyTarget of copyTargets) {
      const { contents, dest, src, transformed } = copyTarget;

      if (transformed) {
        await fs.outputFile(dest, contents);
      } else {
        await fs.copy(src, dest);
      }

      if (verbose) {
        let message = green(`  ${bold(src)} → ${bold(dest)}`);
        const flags = Object.entries(copyTarget)
          .filter(([key, value]) => ["renamed", "transformed"].includes(key) && value)
          .map(([key]) => key.charAt(0).toUpperCase());

        if (flags.length) {
          message = `${message} ${yellow(`[${flags.join(", ")}]`)}`;
        }

        console.log(message);
      }
    }
  } else if (verbose) {
    console.log(yellow("no items to copy"));
  }
}
