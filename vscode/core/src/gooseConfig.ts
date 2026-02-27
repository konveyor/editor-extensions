import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parse, stringify } from "yaml";
import type { GooseConfig, GooseExtensionConfig } from "@editor-extensions/shared";

function getGooseConfigPath(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Block", "goose", "config", "config.yaml");
  }
  return path.join(os.homedir(), ".config", "goose", "config.yaml");
}

export function readGooseConfig(): GooseConfig {
  const configPath = getGooseConfigPath();

  let raw: Record<string, any> = {};
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    raw = (parse(content) as Record<string, any>) ?? {};
  } catch {
    // File missing or malformed — return defaults
  }

  const provider = typeof raw.GOOSE_PROVIDER === "string" ? raw.GOOSE_PROVIDER : "";
  const model = typeof raw.GOOSE_MODEL === "string" ? raw.GOOSE_MODEL : "";

  const extensions: GooseExtensionConfig[] = [];
  const extMap = raw.extensions;
  if (extMap && typeof extMap === "object") {
    for (const [id, extRaw] of Object.entries(extMap)) {
      const ext = extRaw as Record<string, any> | undefined;
      if (!ext || typeof ext !== "object") {
        continue;
      }
      extensions.push({
        id,
        name: typeof ext.display_name === "string" ? ext.display_name : id,
        description: typeof ext.description === "string" ? ext.description : "",
        enabled: ext.enabled !== false,
        type: (ext.type as GooseExtensionConfig["type"]) ?? "builtin",
        bundled: ext.bundled !== false,
      });
    }
  }

  return { provider, model, extensions, hasStoredCredentials: false };
}

export interface WriteGooseConfigChanges {
  provider?: string;
  model?: string;
  extensions?: Array<{ id: string; enabled: boolean }>;
}

export function writeGooseConfig(changes: WriteGooseConfigChanges): void {
  const configPath = getGooseConfigPath();

  let raw: Record<string, any> = {};
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    raw = (parse(content) as Record<string, any>) ?? {};
  } catch {
    // Start from scratch if missing/malformed
  }

  if (changes.provider !== undefined) {
    raw.GOOSE_PROVIDER = changes.provider;
  }
  if (changes.model !== undefined) {
    raw.GOOSE_MODEL = changes.model;
  }

  if (changes.extensions) {
    if (!raw.extensions || typeof raw.extensions !== "object") {
      raw.extensions = {};
    }
    for (const ext of changes.extensions) {
      if (raw.extensions[ext.id] && typeof raw.extensions[ext.id] === "object") {
        raw.extensions[ext.id].enabled = ext.enabled;
      } else {
        raw.extensions[ext.id] = { enabled: ext.enabled };
      }
    }
  }

  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, stringify(raw), "utf-8");
}
