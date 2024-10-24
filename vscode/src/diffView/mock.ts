import * as vscode from "vscode";
import path from "path";
import { MemFS } from "./fileSystemProvider";

const basePath = ["src", "main", "java", "com", "redhat", "coolstore", "service"];

export const testPaths = [
  path.join(...basePath, "OrderService.java"),
  path.join(...basePath, "CatalogService.java"),
  path.join(...basePath, "ProductService.java"),
  path.join(...basePath, "ShippingService.java"),
  path.join(...basePath, "ShoppingCartOrderProcessor.java"),
];

export const testLocations = testPaths.map(
  (testPath) =>
    new vscode.Location(
      vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? "", testPath)),
      new vscode.Position(0, 0),
    ),
);

export const writeResponse = (changedFiles: { [k: string]: string }, memFs: MemFS): void => {
  basePath.reduce((acc: string, segment: string): string => {
    const newPath = path.join(acc, segment);
    memFs.createDirectory(vscode.Uri.parse(`konveyorMemFs:/${newPath}`));
    return newPath;
  }, "");

  Object.entries(changedFiles).forEach(([fsPath, content]) =>
    memFs.writeFile(vscode.Uri.parse(`konveyorMemFs:/${fsPath}`), Buffer.from(content), {
      create: true,
      overwrite: true,
    }),
  );
};
