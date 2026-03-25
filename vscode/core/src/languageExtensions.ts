import * as vscode from "vscode";
import { EXTENSION_NAME, EXTENSION_PUBLISHER, EXTENSION_SHORT_NAME } from "./utilities/constants";

export interface KnownLanguageExtension {
  id: string;
  displayName: string;
  language: string;
}

const EXTENSION_BASE_NAME = EXTENSION_NAME.replace(/-core$/, "");

const SUPPORTED_LANGUAGES = ["java", "go", "javascript", "csharp"] as const;

const LANGUAGE_DISPLAY: Record<(typeof SUPPORTED_LANGUAGES)[number], string> = {
  java: "Java",
  go: "Go",
  javascript: "JavaScript",
  csharp: "C#",
};

/**
 * Known language extensions that provide analysis providers.
 * Derived from build-time constants to support downstream rebranding.
 */
export const KNOWN_LANGUAGE_EXTENSIONS: KnownLanguageExtension[] = SUPPORTED_LANGUAGES.map(
  (lang) => ({
    id: `${EXTENSION_PUBLISHER}.${EXTENSION_BASE_NAME}-${lang}`,
    displayName: `${EXTENSION_SHORT_NAME} ${LANGUAGE_DISPLAY[lang]}`,
    language: lang,
  }),
);

/** Extension pack ID that bundles all language extensions */
export const EXTENSION_PACK_ID = `${EXTENSION_PUBLISHER}.${EXTENSION_BASE_NAME}`;

/**
 * Get the list of known language extensions that are installed.
 */
export function getInstalledLanguageExtensions(): KnownLanguageExtension[] {
  return KNOWN_LANGUAGE_EXTENSIONS.filter((ext) => !!vscode.extensions.getExtension(ext.id));
}
