export interface Incident {
  id: string;
  file: string;
  line: number;
  severity: "High" | "Medium" | "Low";
  message: string;
}
