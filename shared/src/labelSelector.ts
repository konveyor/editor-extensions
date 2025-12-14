/**
 * Builds a label selector string from included and excluded label arrays
 */
export function buildLabelSelectorFromLabels(included: string[], excluded: string[] = []): string {
  const excludedLabels = excluded.map((e) => `!${e}`).join(" && ");
  return `(${included.join(" || ")}) && ${excludedLabels}`;
}

/**
 * Builds a label selector string from arrays of source and target technologies
 * @param sources Array of source technology identifiers
 * @param targets Array of target technology identifiers
 * @returns Label selector string following the format: (targets) && (sources) || (discovery)
 */
export function buildLabelSelector(sources: string[], targets: string[]): string {
  const sourcesPart = sources.map((s) => `konveyor.io/source=${s}`).join(" || ");
  const targetsPart = targets.map((t) => `konveyor.io/target=${t}`).join(" || ");

  // If neither is selected, fall back to "discovery"
  if (!sourcesPart && !targetsPart) {
    return "(discovery)";
  }

  // If only targets are selected, return targets OR discovery
  if (targetsPart && !sourcesPart) {
    return `(${targetsPart}) || (discovery)`;
  }

  // If only sources are selected, return sources OR discovery
  if (sourcesPart && !targetsPart) {
    return `(${sourcesPart}) || (discovery)`;
  }

  // If both are selected, AND sources with targets, then OR with discovery
  return `(${targetsPart}) && (${sourcesPart}) || (discovery)`;
}
