import { exec } from 'node:child_process';
import Parser from 'tree-sitter';
import Java from 'tree-sitter-java';

export function isBuildable(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    exec(`cd ${path} && mvn clean install`, (error, stdout, stderr) => {
      if (process.env.CI) {
        console.log('MVN CLEAN INSTALL output: ');
        console.log(stdout);
      }
      if (error) {
        if (process.env.CI) {
          console.error('MVN CLEAN INSTALL error: ');
          console.error(stderr);
        }
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

export async function isSyntaxValid(fileContent: string): Promise<boolean> {
  try {
    const parser = new Parser();
    parser.setLanguage(Java);
    const tree = parser.parse(fileContent);
    return !tree.rootNode.hasError;
  } catch (err) {
    console.error(`Error while validating syntax of ${fileContent}`, err);
    return false;
  }
}
