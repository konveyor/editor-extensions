const KONVEYOR_IO = "konveyor.io";

/**
 * Returns the (optional) namespace of a label, e.g. "konveyor.io" for
 * "konveyor.io/source=java-ee". Mirrors Go's Label.Namespace().
 */
function labelNamespace(label: string): string {
  const parts = label.split("/");
  return parts.length > 1 ? parts[0] : "";
}

/**
 * Returns the name of a label, e.g. "source" for "konveyor.io/source=java-ee".
 * Mirrors Go's Label.Name(): everything after the last "/", up to the "=".
 */
function labelName(label: string): string {
  const slash = label.lastIndexOf("/");
  const base = slash === -1 ? label : label.slice(slash + 1);
  return base.split("=")[0];
}

/** Joins operands, parenthesizing only when there is more than one. */
function join(operator: string, operands: string[]): string {
  const packed = operands.filter((s) => s.length > 0);
  switch (packed.length) {
    case 0:
      return "";
    case 1:
      return packed[0];
    default:
      return `(${packed.join(operator)})`;
  }
}

/** Joins operands and negates the result. */
function notjoin(operator: string, operands: string[]): string {
  const packed = operands.filter((s) => s.length > 0);
  switch (packed.length) {
    case 0:
      return "";
    case 1:
      return `!${packed[0]}`;
    default:
      return `!(${packed.join(operator)})`;
  }
}

/**
 * De-duplicates and sorts.
 *
 * The Hub builds a bundle's `rules.labels.included` by ranging over a Go map
 * (ApBundle.expandIncluded), so the order it arrives in changes from one request
 * to the next. Sorting keeps the selector we derive stable, which matters
 * because it gets written into the workspace at
 * .konveyor/hub-profiles/<id>/profile.yaml on every sync. Order carries no
 * meaning in a selector, `(a||b)` and `(b||a)` match the same rules.
 */
const normalize = (list: string[]): string[] => [...new Set(list)].sort();

/**
 * Builds a label selector from a Hub analysis profile's included/excluded labels.
 *
 * This is a faithful port of RuleSelector.String() in tackle2-addon-analyzer
 * (cmd/rules.go). Source and target labels are NOT simply OR-ed together: they
 * are partitioned and AND-ed, because the pair encodes a migration path
 * ("from these sources, to these targets"). OR-ing them instead pulls in rules
 * for unrelated destinations.
 *
 * The Hub flattens target labels into `rules.labels.included` when it builds a
 * profile bundle (ApBundle.expandIncluded), so the source/target split has to be
 * recovered here from the label names.
 *
 *   (other...) || ((sources...) && (targets...)) && !(excluded...)
 *
 * Keep this in sync with the Hub: if the two disagree, an analysis run in the
 * IDE reports a different set of issues than the same profile run on the Hub.
 */
export function buildLabelSelectorFromLabels(included: string[], excluded: string[] = []): string {
  const other: string[] = [];
  const sources: string[] = [];
  const targets: string[] = [];

  for (const label of normalize(included)) {
    if (labelNamespace(label) !== KONVEYOR_IO) {
      other.push(label);
      continue;
    }
    switch (labelName(label)) {
      case "source":
        sources.push(label);
        break;
      case "target":
        targets.push(label);
        break;
      default:
        other.push(label);
    }
  }

  const ands = [join("||", sources), join("||", targets)];

  let selector = join("||", other);
  selector = join("||", [selector, join("&&", ands)]);
  selector = join("&&", [selector, notjoin("||", normalize(excluded))]);

  return selector;
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
