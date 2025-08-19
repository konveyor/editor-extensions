import * as fs from 'fs';
import * as pathlib from 'path';
import * as crypto from 'crypto';
import AdmZip from 'adm-zip';

export function extractZip(zipPath: string, destDir: string) {
  new AdmZip(zipPath).extractAllTo(destDir, true);
}

export function createZip(sourceDir: string, outputZip: string, sourceZip?: string) {
  const tree = createDirectoryTree(sourceDir);
  const newZip = sourceZip ? new AdmZip(sourceZip) : new AdmZip();
  const addDirContentsToZip = (zip: AdmZip, dir: string, zipRootPath: string = '') => {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = pathlib.join(dir, item);
      const relativePathInZip = pathlib.join(zipRootPath, item);
      if (fs.statSync(fullPath).isDirectory()) {
        addDirContentsToZip(zip, fullPath, relativePathInZip);
      } else {
        zip.addLocalFile(fullPath, pathlib.dirname(relativePathInZip));
      }
    }
  };
  addDirContentsToZip(newZip, sourceDir);
  newZip.writeZip(outputZip);
  const sha256 = createSha256Sum(outputZip);
  fs.writeFileSync(`${outputZip}.metadata`, `SHA: ${sha256}\nTree:\n${tree}\n`, 'utf-8');
}

export function createDirectoryTree(rootDir: string, maxDepth: number = 4): string {
  const tree: string[] = [];
  function buildTree(dir: string, prefix: string = '', depth: number = 0): void {
    if (depth > maxDepth || !fs.existsSync(dir)) {
      return;
    }
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      const sortedItems = items.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) {
          return -1;
        }
        if (!a.isDirectory() && b.isDirectory()) {
          return 1;
        }
        return a.name.localeCompare(b.name);
      });
      sortedItems.forEach((item, index) => {
        const isLast = index === sortedItems.length - 1;
        const currentPrefix = isLast ? '└── ' : '├── ';
        const nextPrefix = prefix + (isLast ? '    ' : '│   ');

        tree.push(`${prefix}${currentPrefix}${item.name}`);

        if (item.isDirectory() && depth < maxDepth) {
          const itemPath = pathlib.join(dir, item.name);
          buildTree(itemPath, nextPrefix, depth + 1);
        }
      });
    } catch (error) {
      tree.push(`${prefix}├── [Error reading directory: ${error}]`);
    }
  }
  tree.push(pathlib.basename(rootDir));
  buildTree(rootDir, '', 0);
  return tree.join('\n');
}

export function createSha256Sum(zipPath: string): string {
  const fileBuffer = fs.readFileSync(zipPath);
  const hash = crypto.createHash('sha256');
  hash.update(fileBuffer);
  return hash.digest('hex');
}
