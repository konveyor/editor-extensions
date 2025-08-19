/**
 * IDE utilities for file operations
 * Provides simple wrappers around VS Code file system APIs
 */

import * as vscode from "vscode";

export async function readFile(filepath: string): Promise<string> {
  try {
    const uri = vscode.Uri.file(filepath);
    const content = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(content).toString("utf8");
  } catch (error) {
    console.error(`Failed to read file ${filepath}:`, error);
    throw error;
  }
}

export async function saveFile(filepath: string): Promise<void> {
  try {
    const uri = vscode.Uri.file(filepath);
    const document = await vscode.workspace.openTextDocument(uri);
    await document.save();
  } catch (error) {
    console.error(`Failed to save file ${filepath}:`, error);
    throw error;
  }
}

export async function openFile(filepath: string): Promise<void> {
  try {
    const uri = vscode.Uri.file(filepath);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
  } catch (error) {
    console.error(`Failed to open file ${filepath}:`, error);
    throw error;
  }
}

export async function getCurrentFile(): Promise<{ path: string } | undefined> {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    return { path: activeEditor.document.fileName };
  }
  return undefined;
}

/**
 * FileEditor interface implementation for the vertical diff system
 */
export class FileEditor {
  readFile = readFile;
  saveFile = saveFile;
  openFile = openFile;
  getCurrentFile = getCurrentFile;
}
