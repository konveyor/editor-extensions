import * as vscode from "vscode";

export interface FileTreeModel<T> {
  provider: vscode.TreeDataProvider<T>;

  /**
   * An optional message that is displayed above the tree. Whenever the provider
   * fires a change event this message is read again.
   */
  message: string | undefined;

  /**
   * Optional support for symbol navigation. When implemented, navigation commands like
   * "Go to Next" and "Go to Previous" will be working with this model.
   */
  navigation?: FileItemNavigation<T>;

  /**
   * Optional dispose function which is invoked when this model is
   * needed anymore
   */
  dispose?(): void;
}

export interface FileItemNavigation<T> {
  /**
   * Return the next item from the given item or the item itself.
   */
  next(from: T): T;
  /**
   * Return the previous item from the given item or the item itself.
   */
  previous(from: T): T;

  location(item: T): vscode.Location;
}
