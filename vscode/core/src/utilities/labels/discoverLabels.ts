import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const LABEL_PATTERN = /konveyor\.io\/(target|source)=([^\s"']+)/g;

export interface DiscoveredLabels {
  targets: string[];
  sources: string[];
}

/**
 * Scan all YAML rule files in the given rulesets directory and extract
 * unique `konveyor.io/target` and `konveyor.io/source` label values.
 */
export async function discoverLabels(rulesetsDir: string): Promise<DiscoveredLabels> {
  let entries: string[];
  try {
    const dirEntries = await readdir(rulesetsDir, { recursive: true });
    entries = dirEntries.filter((e) => e.endsWith(".yaml")).map((e) => join(rulesetsDir, e));
  } catch {
    return { targets: [], sources: [] };
  }

  if (entries.length === 0) {
    return { targets: [], sources: [] };
  }

  const targets = new Set<string>();
  const sources = new Set<string>();

  const contents = await Promise.all(entries.map((f) => readFile(f, "utf-8").catch(() => "")));

  for (const content of contents) {
    for (const match of content.matchAll(LABEL_PATTERN)) {
      const kind = match[1];
      const value = match[2];
      if (kind === "target") {
        targets.add(value);
      } else {
        sources.add(value);
      }
    }
  }

  return {
    targets: Array.from(targets).sort(),
    sources: Array.from(sources).sort(),
  };
}
