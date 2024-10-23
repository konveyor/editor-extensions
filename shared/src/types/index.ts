export interface Incident {
  uri: string;
  lineNumber: number;
  severity: "High" | "Medium" | "Low";
  message: string;
  codeSnip: string;
}

export interface Link {
  url: string;
  title?: string;
}

export enum Category {
  Potential = "potential",
  Optional = "optional",
  Mandatory = "mandatory",
}

export interface Violation {
  description: string;
  category?: Category;
  labels?: string[];
  incidents: Incident[];
  links?: Link[];
  extras?: unknown;
  effort?: number;
}

export interface RuleSet {
  name?: string;
  description?: string;
  tags?: string[];
  violations?: { [key: string]: Violation };
  insights?: { [key: string]: Violation };
  errors?: { [key: string]: string };
  unmatched?: string[];
  skipped?: string[];
}
