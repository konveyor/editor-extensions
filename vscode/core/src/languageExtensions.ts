import * as vscode from "vscode";
import { EXTENSION_PUBLISHER, EXTENSION_SHORT_NAME } from "./utilities/constants";

export interface KnownLanguageExtension {
  id: string;
  displayName: string;
  language: string;
}

/**
 * Known Konveyor language extensions that provide analysis providers.
 * Uses EXTENSION_PUBLISHER to support downstream rebranding.
 */
export const KNOWN_LANGUAGE_EXTENSIONS: KnownLanguageExtension[] = [
  {
    id: `${EXTENSION_PUBLISHER}.konveyor-java`,
    displayName: `${EXTENSION_SHORT_NAME} Java`,
    language: "java",
  },
  {
    id: `${EXTENSION_PUBLISHER}.konveyor-go`,
    displayName: `${EXTENSION_SHORT_NAME} Go`,
    language: "go",
  },
  {
    id: `${EXTENSION_PUBLISHER}.konveyor-javascript`,
    displayName: `${EXTENSION_SHORT_NAME} JavaScript`,
    language: "javascript",
  },
  {
    id: `${EXTENSION_PUBLISHER}.konveyor-csharp`,
    displayName: `${EXTENSION_SHORT_NAME} C#`,
    language: "csharp",
  },
];

/** Extension pack ID that bundles all language extensions */
export const EXTENSION_PACK_ID = `${EXTENSION_PUBLISHER}.konveyor`;

/**
 * Get the list of known language extensions that are installed.
 */
export function getInstalledLanguageExtensions(): KnownLanguageExtension[] {
  return KNOWN_LANGUAGE_EXTENSIONS.filter((ext) => !!vscode.extensions.getExtension(ext.id));
}
