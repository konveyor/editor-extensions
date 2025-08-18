/**
 * Simple VS Code IDE implementation for Continue's vertical diff system
 * This provides the minimal IDE interface needed by VerticalDiffManager
 */

import * as vscode from "vscode";
import { IDE } from "./types";

export class VsCodeIde implements IDE {
  async readFile(filepath: string): Promise<string> {
    try {
      const uri = vscode.Uri.file(filepath);
      const content = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(content).toString("utf8");
    } catch (error) {
      console.error(`Failed to read file ${filepath}:`, error);
      throw error;
    }
  }

  async saveFile(filepath: string): Promise<void> {
    try {
      const uri = vscode.Uri.file(filepath);
      const document = await vscode.workspace.openTextDocument(uri);
      await document.save();
    } catch (error) {
      console.error(`Failed to save file ${filepath}:`, error);
      throw error;
    }
  }

  async openFile(filepath: string): Promise<void> {
    try {
      const uri = vscode.Uri.file(filepath);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
    } catch (error) {
      console.error(`Failed to open file ${filepath}:`, error);
      throw error;
    }
  }

  async getCurrentFile(): Promise<{ path: string } | undefined> {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      return { path: activeEditor.document.fileName };
    }
    return undefined;
  }
}
