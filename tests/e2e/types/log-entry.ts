export interface LogEntry {
  component?: string;
  level: string;
  message: string;
  timestamp: string;
  [key: string]: any;
}
