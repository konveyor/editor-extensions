import * as fs from 'fs';
import * as path from 'path';

import * as yaml from 'js-yaml';

import { expect, test } from '../../fixtures/test-repo-fixture';
import { HubConfigurationPage } from '../../pages/hub-configuration.page';
import { VSCode } from '../../pages/vscode.page';
import { SEC } from '../../utilities/consts';
import { getHubConfig } from '../../utilities/utils';
import * as VSCodeFactory from '../../utilities/vscode.factory';

/**
 * The hub's analyzer addon builds its label selector by splitting the profile's
 * included labels into sources and targets and ANDing the two groups
 * (RuleSelector.String() in tackle2-addon-analyzer). The extension has to derive
 * the same selector from the synced bundle, otherwise analyzing with a
 * hub-managed profile reports a different set of issues than the hub does.
 *
 * Depends on the "Label Selector" profile created by tests/scripts/seed-hub.sh:
 * targets Containerization and Open Liberty, plus additional source labels
 * javaee and websphere. The hub flattens the target labels into
 * rules.labels.included when it builds the bundle, so all four arrive at the
 * extension in a single list with nothing marking which is which.
 *
 * The application's source code is irrelevant here. Nothing is analyzed, we only
 * check what the sync wrote to disk.
 */
const SELECTOR_PROFILE_NAME = 'Label Selector';

const EXPECTED_LABEL_SELECTOR =
  '((konveyor.io/source=javaee||konveyor.io/source=websphere)&&' +
  '(konveyor.io/target=cloud-readiness||konveyor.io/target=openliberty))';

interface SyncedProfile {
  metadata?: { name?: string; source?: string };
  spec?: { labelSelector?: string; useDefaultRules?: boolean };
}

/**
 * Reads every profile.yaml the extension wrote under .konveyor/hub-profiles.
 */
function readSyncedProfiles(repoDir: string): SyncedProfile[] {
  const hubProfilesDir = path.resolve(repoDir, '.konveyor', 'hub-profiles');
  if (!fs.existsSync(hubProfilesDir)) {
    return [];
  }

  return fs
    .readdirSync(hubProfilesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(hubProfilesDir, entry.name, 'profile.yaml'))
    .filter((profileYaml) => fs.existsSync(profileYaml))
    .map((profileYaml) => yaml.load(fs.readFileSync(profileYaml, 'utf-8')) as SyncedProfile);
}

function findSelectorProfile(repoDir: string): SyncedProfile | undefined {
  return readSyncedProfiles(repoDir).find(
    (profile) => profile.metadata?.name === SELECTOR_PROFILE_NAME
  );
}

test.describe(
  'Hub profile label selector',
  {
    tag: ['@tier3', '@requires-minikube'],
  },
  () => {
    test.setTimeout(600000);
    let vscodeApp: VSCode;

    test.beforeAll(async ({ testRepoData }) => {
      test.setTimeout(600000);
      vscodeApp = await VSCodeFactory.init(testRepoData['coolstore']);

      const hubConfigPage = await HubConfigurationPage.open(vscodeApp);
      await hubConfigPage.fillForm(
        getHubConfig({ profileSyncEnabled: true, solutionServerEnabled: false })
      );
    });

    test('synced profile uses the same label selector as the hub', async () => {
      expect(vscodeApp.repoDir, 'repoDir must be set to locate the synced profile').toBeTruthy();
      const repoDir = vscodeApp.repoDir!;

      // Wait on the file rather than on a notification. The sync toast can be
      // dismissed or missed, but the profile landing on disk is the thing we
      // actually care about.
      await expect
        .poll(() => findSelectorProfile(repoDir) !== undefined, {
          message: `expected the "${SELECTOR_PROFILE_NAME}" profile to sync from the hub`,
          timeout: 120 * SEC,
          intervals: [2 * SEC],
        })
        .toBe(true);

      const profile = findSelectorProfile(repoDir)!;
      console.log('Synced label selector:', profile.spec?.labelSelector);

      expect(profile.spec?.labelSelector).toBe(EXPECTED_LABEL_SELECTOR);
    });

    test.afterAll(async () => {
      await vscodeApp?.closeVSCode();
    });
  }
);
