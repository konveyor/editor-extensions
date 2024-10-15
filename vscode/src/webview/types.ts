export interface Incident {
  uri: string;
  lineNumber: number;
  severity: "High" | "Medium" | "Low";
  message: string;
  codeSnip: string;
}

export interface RuleSet {
  // Name is a name for the ruleset.
  name?: string;

  // Description text description for the ruleset.
  description?: string;

  // Tags list of generated tags from the rules in this ruleset.
  tags?: string[];

  // Violations is a map containing violations generated for the
  // matched rules in this ruleset. Keys are rule IDs, values are
  // their respective generated violations.
  violations?: { [key: string]: Violation };

  // Insights is a map containing violations generated for informational rules
  // in a ruleset. These rules do not have an effort. They exist to provide
  // additional information about a tag.
  insights?: { [key: string]: Violation };

  // Errors is a map containing errors generated during evaluation
  // of rules in this ruleset. Keys are rule IDs, values are
  // their respective generated errors.
  errors?: { [key: string]: string };

  // Unmatched is a list of rule IDs of the rules that weren't matched.
  unmatched?: string[];

  // Skipped is a list of rule IDs that were skipped
  skipped?: string[];
}

export interface Violation {
  // Description text description about the violation
  // TODO: we don't have this in the rule as of today.
  description: string;

  // Category category of the violation
  // TODO: add this to rules
  category?: Category;

  labels?: string[];

  // Incidents list of instances of violation found
  incidents: Incident[];

  // ExternalLinks hyperlinks to external sources of docs, fixes
  links?: Link[];

  // Extras reserved for additional data
  extras?: unknown; // Using 'any' as a replacement for json.RawMessage

  // Effort defines expected story points for this incident
  effort?: number;
}

export enum Category {
  Potential = "potential",
  Optional = "optional",
  Mandatory = "mandatory",
}

// Link defines an external hyperlink
export interface Link {
  // URL of the external hyperlink
  url: string;

  // Title optional description
  title?: string;
}
