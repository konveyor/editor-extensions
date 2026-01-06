import * as path from "path";
import * as fs from "fs/promises";
import * as yaml from "js-yaml";
import { AnalysisProfile } from "@editor-extensions/shared";

const PROFILES_DIR = ".konveyor/profiles";

interface ProfileYamlMetadata {
  name: string;
  id: string;
  source?: "local" | "hub" | "bundled";
  version?: string;
  readonly?: boolean;
  syncedAt?: string;
}

interface ProfileYamlSpec {
  labelSelector: string;
  customRules?: string[];
  useDefaultRules?: boolean;
}

interface ProfileYaml {
  metadata: ProfileYamlMetadata;
  spec: ProfileYamlSpec;
}

/**
 * Discovers all profile.yaml files in .konveyor/profiles/ directory
 */
export async function discoverInTreeProfiles(workspaceRoot: string): Promise<AnalysisProfile[]> {
  const profilesPath = path.join(workspaceRoot, PROFILES_DIR);

  try {
    // Check if .konveyor/profiles/ exists
    const stat = await fs.stat(profilesPath);
    if (!stat.isDirectory()) {
      return [];
    }
  } catch {
    // Directory doesn't exist
    return [];
  }

  try {
    const entries = await fs.readdir(profilesPath, { withFileTypes: true });
    const profiles: AnalysisProfile[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const profileDir = path.join(profilesPath, entry.name);
      const profileYamlPath = path.join(profileDir, "profile.yaml");

      try {
        const profileContent = await fs.readFile(profileYamlPath, "utf-8");
        const profile = parseProfileYaml(profileContent, profileDir);
        if (profile) {
          // Check for .hub-metadata.json to mark Hub-synced profiles as read-only
          const hubMetadataPath = path.join(profileDir, ".hub-metadata.json");
          try {
            await fs.access(hubMetadataPath);
            // Hub-managed profile - force read-only and set source
            profile.readOnly = true;
            profile.source = "hub";
          } catch {
            // No hub metadata, profile is local (readOnly already set from YAML)
          }
          profiles.push(profile);
        }
      } catch (error) {
        console.warn(`Failed to load profile from ${profileYamlPath}:`, error);
        // Continue to next profile
      }
    }

    return profiles;
  } catch (error) {
    console.error(`Failed to read profiles directory ${profilesPath}:`, error);
    return [];
  }
}

/**
 * Parses YAML content and transforms to AnalysisProfile interface
 */
function parseProfileYaml(yamlContent: string, profileDir: string): AnalysisProfile | null {
  try {
    const parsed = yaml.load(yamlContent) as ProfileYaml;

    // Check if YAML is null or not an object
    if (!parsed || typeof parsed !== "object") {
      console.warn("Profile YAML is empty or invalid");
      return null;
    }

    // Validate required fields
    if (!parsed.metadata || !parsed.spec) {
      console.warn("Profile YAML missing required metadata or spec sections");
      return null;
    }

    if (!parsed.metadata.id || !parsed.metadata.name) {
      console.warn("Profile YAML missing required metadata.id or metadata.name");
      return null;
    }

    if (parsed.spec.labelSelector === undefined) {
      console.warn("Profile YAML missing required spec.labelSelector");
      return null;
    }

    // Resolve custom rules paths
    const customRules = parsed.spec.customRules
      ? resolveCustomRulePaths(parsed.spec.customRules, profileDir)
      : [];

    // Transform to AnalysisProfile interface
    const profile: AnalysisProfile = {
      id: String(parsed.metadata.id),
      name: parsed.metadata.name,
      labelSelector: parsed.spec.labelSelector,
      customRules,
      useDefaultRules: parsed.spec.useDefaultRules ?? true,
      readOnly: parsed.metadata.readonly ?? false,
      source: parsed.metadata.source ?? "local",
      version: parsed.metadata.version,
      syncedAt: parsed.metadata.syncedAt,
    };

    return profile;
  } catch (error) {
    console.error("Failed to parse profile YAML:", error);
    return null;
  }
}

/**
 * Resolves relative customRules paths to absolute paths
 */
function resolveCustomRulePaths(customRules: string[], profileDir: string): string[] {
  return customRules.map((rulePath) => {
    // If path is already absolute, return as-is
    if (path.isAbsolute(rulePath)) {
      return rulePath;
    }
    // Resolve relative to profile directory
    return path.resolve(profileDir, rulePath);
  });
}
