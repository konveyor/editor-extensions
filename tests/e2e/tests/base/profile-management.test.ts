import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { generateRandomString } from '../../utilities/utils';
import { KAIViews } from '../../enums/views.enum';
import { FrameLocator } from 'playwright';
import { ProfileActions } from '../../enums/profile-action-types.enum';
import * as VSCodeFactory from '../../utilities/vscode.factory';

test.describe(`Profile Tests`, () => {
  let vscodeApp: VSCode;
  const profileNameWithRules = `profileWithRules-${generateRandomString()}`;
  const createdProfiles: string[] = [];
  let profileView: FrameLocator;

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(600000);
    const repoInfo = testRepoData['inventory_management'];
    vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
    await vscodeApp.executeQuickCommand('Konveyor: Manage Analysis Profile');
  });

  test.beforeEach(async () => {
    const testName = test.info().title.replace(' ', '-');
    console.log(`Starting ${testName} at ${new Date()}`);
    profileView = await vscodeApp.getView(KAIViews.manageProfiles);
  });

  test('Create empty Profile', async () => {
    const emptyProfileName = `emptyprofile-${generateRandomString()}`;
    await vscodeApp.createProfile([], [], emptyProfileName);
    await expect(profileView.getByText('Fix validation errors before continuing.')).toBeVisible();
    createdProfiles.push(emptyProfileName);
  });

  test.skip('Create Profile and Set Sources targets and custom rules', async ({ testRepoData }) => {
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
    createdProfiles.push(profileNameWithRules);
  });

  test.skip('Remove Custom Rules from profile ', async () => {
    await vscodeApp.removeProfileCustomRules(`${profileNameWithRules} (active)`, profileView);
  });

  test('Create profile With Existing Name', async ({ testRepoData }) => {
    const existingProfileName = await getOrCreateProfile(testRepoData);
    const repoInfo = testRepoData['inventory_management'];
    const errorMessage = profileView.locator('.pf-m-error', {
      hasText: 'A profile with this name already exists.',
    });
    await vscodeApp.getWindow().pause();
    await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, existingProfileName);
    createdProfiles.push(`${existingProfileName}`);
    await expect(errorMessage).toBeVisible();
  });

  test('Activate Profile', async () => {
    await verifyProfileActivationFlow(false);
  });

  test('Duplicate Profile using action button', async ({ testRepoData }) => {
    const profileToDuplicate = await getOrCreateProfile(testRepoData);

    await vscodeApp.doMenuButtonAction(
      profileToDuplicate,
      ProfileActions.duplicateProfile,
      profileView
    );
    createdProfiles.push(profileToDuplicate);
  });

  test('Activate Profile using action Button', async () => {
    test.setTimeout(300000);
    await verifyProfileActivationFlow(true);
  });

  test.skip('Delete profile using action Button', async ({ testRepoData }) => {
    test.setTimeout(300000);
    let toDelete = await getOrCreateProfile(testRepoData);
    await vscodeApp.deleteProfile(toDelete);
  });

  test.afterAll(async () => {
    for (const profileStr of createdProfiles) {
      await vscodeApp.deleteProfile(profileStr);
    }
  });

  async function verifyActiveByButton(
    vscodeApp: VSCode,
    profileView: FrameLocator,
    profileName: string,
    shouldBeActive: boolean
  ) {
    await vscodeApp.clickOnProfileContainer(profileName, profileView);

    if (shouldBeActive) {
      await expect(profileView.getByRole('button', { name: 'Active Profile' })).toBeVisible();
      await expect(profileView.getByRole('button', { name: 'Active Profile' })).toBeDisabled();
    } else {
      await expect(profileView.getByRole('button', { name: 'Make Active' })).toBeVisible();
      await expect(profileView.getByRole('button', { name: 'Make Active' })).toBeEnabled();
    }
  }

  async function verifyActiveByList(
    profileView: FrameLocator,
    profileName: string,
    shouldBeActive: boolean
  ) {
    const activeLabel = profileView.getByText(`${profileName} (active)`);
    if (shouldBeActive) {
      await expect(activeLabel).toBeVisible();
    } else {
      await expect(activeLabel).toHaveCount(0);
    }
  }

  async function verifyProfileIsActive(
    vscodeApp: VSCode,
    profileView: FrameLocator,
    profileName: string,
    shouldBeActive: boolean
  ) {
    await verifyActiveByList(profileView, profileName, shouldBeActive);
    await verifyActiveByButton(vscodeApp, profileView, profileName, shouldBeActive);
  }

  async function verifyProfileActivationFlow(activateByActionButton: boolean) {
    const profile1 = `profile1-${generateRandomString()}`;
    const profile2 = `profile2-${generateRandomString()}`;

    await vscodeApp.createProfile([], [], profile1);
    createdProfiles.push(profile1);
    await verifyProfileIsActive(vscodeApp, profileView, profile1, true);

    //Create second profile and verify activation swapped
    await vscodeApp.createProfile([], [], profile2);
    createdProfiles.push(profile2);
    await verifyActiveByList(profileView, profile1, false);
    await verifyProfileIsActive(vscodeApp, profileView, profile2, true);

    if (activateByActionButton) {
      await vscodeApp.doMenuButtonAction(profile1, ProfileActions.activateProfile, profileView);
    } else {
      await vscodeApp.activateProfile(profile1);
    }

    await verifyProfileIsActive(vscodeApp, profileView, profile1, true);

    console.log('Verified profile activation flow successfully');
  }

  async function getOrCreateProfile(testRepoData: any): Promise<string> {
    if (createdProfiles.length > 0) {
      return createdProfiles[0];
    }

    const repoInfo = testRepoData['inventory_management'];
    const newProfile = `tmp-${generateRandomString()}`;
    await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, newProfile);
    createdProfiles.push(newProfile);
    return newProfile;
  }
});
