export type SolutionEffortLevel = "Low" | "Medium" | "High" | "Maximum (experimental)";

export const effortLevels: Record<SolutionEffortLevel, number | undefined> = {
  Low: 0,
  Medium: 1,
  High: 2,
  "Maximum (experimental)": undefined,
};

export function getEffortValue(level: SolutionEffortLevel): number | undefined {
  return effortLevels[level];
}

export function getTruncatedEffortLevel(level: SolutionEffortLevel): string {
  switch (level) {
    case "Low":
      return "Low";
    case "Medium":
      return "Med";
    case "High":
      return "High";
    case "Maximum (experimental)":
      return "Max";
    default:
      return "";
  }
}
