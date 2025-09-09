import { extensionShortName, getAnalysisViewTitle } from '../utilities/utils';

export const KAIViews = {
  manageProfiles: `${extensionShortName} Manage Profiles`,
  resolutionDetails: `${extensionShortName} Resolution Details`,
  analysisView: getAnalysisViewTitle(),
} as const;
