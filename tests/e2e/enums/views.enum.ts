import { extensionShortName, getAnalysisViewTitle } from '../utilities/utils';

export const KAIViews = {
  manageProfiles: `${extensionShortName} Manage Profiles`,
  /** The Migration Chat popped out into an editor tab (see VSCode.openMigrationChatInEditor). */
  migrationAssistant: `${extensionShortName} Migration Assistant`,
  analysisView: getAnalysisViewTitle(),
  hubConfiguration: `${extensionShortName} Hub Configuration`,
} as const;
