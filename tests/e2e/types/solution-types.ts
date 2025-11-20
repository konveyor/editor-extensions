export type SolutionStatus = {
  hasAccepted: boolean;
  hasRejected: boolean;
};

export type SolutionsMap = Record<string, SolutionStatus>;
