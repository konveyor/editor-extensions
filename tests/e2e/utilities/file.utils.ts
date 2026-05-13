import * as fs from 'fs';

export function getFileImports(absoluteFilePath: string): string[] {
  if (!fs.existsSync(absoluteFilePath)) {
    return [];
  }
  const importsData: string[] = [];
  const data = fs.readFileSync(absoluteFilePath, 'utf-8');
  const lines = data.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('import')) {
      importsData.push(line);
    }
  }
  return importsData;
}
