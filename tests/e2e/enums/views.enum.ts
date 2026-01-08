import { extensionShortName, getAnalysisViewTitle } from '../utilities/utils';

export const KAIViews = {
  manageProfiles: `${extensionShortName} Manage Profiles`,
  resolutionDetails: `${extensionShortName} Resolution Details`,
  analysisView: getAnalysisViewTitle(),
  hubConfiguration: `${extensionShortName} Hub Configuration`,
} as const;
