import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { generateRandomString } from '../../utilities/utils';
import { KAIViews } from '../../enums/views.enum';
import { FrameLocator } from 'playwright';
import { ProfileActions } from '../../enums/profile-action-types.enum';
import * as path from 'path';
import { SCREENSHOTS_FOLDER } from '../../utilities/consts';

test.describe(`Profile Tests`, () => {
  let vscodeApp: VSCode;
  const emptyProfileName = `emptyprofile-${generateRandomString()}`;
  const profileNameWithRules = `profileWithRules-${generateRandomString()}`;
  const profileToDuplicate = emptyProfileName;
  const duplicatedProfileName = `${profileToDuplicate} 1`;
  let currActiveProfile: string;
  let profileView: FrameLocator;

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(600000);
    const repoInfo = testRepoData['inventory_management'];
    vscodeApp = await VSCode.open(repoInfo.repoUrl, repoInfo.repoName);
    await vscodeApp.executeQuickCommand('Konveyor: Manage Analysis Profile');
    profileView = await vscodeApp.getView(KAIViews.manageProfiles);
  });

  test.beforeEach(async () => {
    const testName = test.info().title.replace(' ', '-');
    console.log(`Starting ${testName} at ${new Date()}`);
  });

  test('Create empty Profile', async () => {
    test.setTimeout(300000);
    await vscodeApp.createProfile([], [], emptyProfileName);
    currActiveProfile = emptyProfileName;
  });

  test('Create Profile and Set Sources targets and custom rules', async ({ testRepoData }) => {
    test.setTimeout(300000);
    const repoInfo = testRepoData['inventory_management'];
    expect(repoInfo.customRulesFolder).toBeDefined();

    await vscodeApp.createProfile(
      repoInfo.sources,
      repoInfo.targets,
      profileNameWithRules,
      repoInfo.customRulesFolder
    );
    const customRulesList = profileView.getByRole('list', { name: 'Custom Rules' });
    await expect(customRulesList).toBeVisible({ timeout: 5000 });
    currActiveProfile = profileNameWithRules;
  });

  test('Create profile With Existing Name', async () => {
    test.setTimeout(300000);
    await vscodeApp.changeProfileName(emptyProfileName, profileNameWithRules, profileView);
    const errorMessage = profileView.locator('.pf-m-error', {
      hasText: 'A profile with this name already exists.',
    });
    await expect(errorMessage).toBeVisible();
  });

  test('Duplicate Profile', async () => {
    test.setTimeout(300000);
    await vscodeApp.doActionMenuButton(
      profileToDuplicate,
      ProfileActions.duplicateProfile,
      profileView
    );
    currActiveProfile = duplicatedProfileName;
  });

  test('Activate Profile', async () => {
    test.setTimeout(300000);
    const profileToActivate =
      currActiveProfile == profileNameWithRules ? emptyProfileName : profileNameWithRules;
    await vscodeApp.activateProfile(profileToActivate, profileView);
    currActiveProfile = profileToActivate;
  });

  test('Activate Profile using action Button', async () => {
    test.setTimeout(300000);
    const profileToActivate =
      currActiveProfile == profileNameWithRules ? emptyProfileName : profileNameWithRules;
    await vscodeApp.doActionMenuButton(
      profileToActivate,
      ProfileActions.activateProfile,
      profileView
    );
    currActiveProfile = profileToActivate;
  });

  test.skip('Delete profile using action Button', async () => {
    test.setTimeout(300000);
    await vscodeApp.deleteProfile(duplicatedProfileName);
  });

  test('Remove Custom Rules from profile ', async () => {
    test.setTimeout(300000);
    await vscodeApp.removeProfileCustomRules(profileNameWithRules, profileView);
    await vscodeApp.waitDefault();
  });

  test.afterEach(async () => {
    const testName = test.info().title.replace(' ', '-');
    console.log(`Finished ${testName} at ${new Date()}`);
    await vscodeApp.getWindow().screenshot({
      path: `${SCREENSHOTS_FOLDER}/after-${testName}.png`,
    });
  });
  test.afterAll(async () => {
    await vscodeApp.deleteProfile(emptyProfileName);
    await vscodeApp.deleteProfile(profileNameWithRules);
    await vscodeApp.closeVSCode();
  });
});
