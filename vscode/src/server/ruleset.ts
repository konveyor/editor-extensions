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

export interface Violation {
    description: string;
    category?: Category;
    labels?: string[];
    incidents: Incident[];
    links?: Link[];
    effort?: number;
}

export interface Incident {
    uri: string;
    message: string;
    codeSnip?: string;
    lineNumber?: number;
}

interface Link {
    url: string;
    title?: string;
}

export enum Category {
    Potential = "potential",
    Optional = "optional",
    Mandatory = "mandatory"
}
