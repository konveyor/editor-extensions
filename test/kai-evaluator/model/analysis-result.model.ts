export interface AnalysisResult {
  name: string;
  description: string;
  violations: {
    [key: string]: Violation;
  };
  unmatched: string;
  skipped: string;
}

export interface Incident {
  message: string;
  codeSnip: string;
  lineNumber: number;
  uri: string;
}

export interface Violation {
  description: string;
  category: string;
  labels: string[];
  incidents: Incident[];
}
