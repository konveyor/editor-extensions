import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { generateRandomString } from '../../utilities/utils';
import { KAIViews } from '../../enums/views.enum';
import { FrameLocator } from 'playwright';
import { ProfileActions } from '../../enums/profile-action-types.enum';
import * as VSCodeFactory from '../../utilities/vscode.factory';

test.describe(`Profile Tests`, () => {
  let vscodeApp: VSCode;
  const emptyProfileName = `emptyprofile-${generateRandomString()}`;
  const profileNameWithRules = `profileWithRules-${generateRandomString()}`;
  const profileToDuplicate = emptyProfileName;
  const duplicatedProfileName = `${profileToDuplicate} 1`;
  const existingProfileName = `existing-${generateRandomString()}`;
  const profilesToDelete: string[] = [];
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
    test.setTimeout(300000);
    await vscodeApp.createProfile([], [], emptyProfileName);
    await expect(profileView.getByText('Fix validation errors before continuing.')).toBeVisible();
    profilesToDelete.push(emptyProfileName);
  });

  test.skip('Create Profile and Set Sources targets and custom rules', async ({ testRepoData }) => {
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
    profilesToDelete.push(profileNameWithRules);
  });

  test.skip('Remove Custom Rules from profile ', async () => {
    test.setTimeout(300000);
    await vscodeApp.removeProfileCustomRules(`${profileNameWithRules} (active)`, profileView);
  });

  test('Create profile With Existing Name', async () => {
    test.setTimeout(300000);
    await vscodeApp.createProfile([], [], existingProfileName);
    //creating a profile with the same name
    profilesToDelete.push(existingProfileName);
    await vscodeApp.createProfile([], [], existingProfileName);
    const errorMessage = profileView.locator('.pf-m-error', {
      hasText: 'A profile with this name already exists.',
    });
    profilesToDelete.unshift(`${existingProfileName} 1`);
    await expect(errorMessage).toBeVisible();
  });

  test('Duplicate Profile', async () => {
    test.setTimeout(300000);
    await vscodeApp.doMenuButtonAction(
      profileToDuplicate,
      ProfileActions.duplicateProfile,
      profileView
    );
    profilesToDelete.unshift(`${profileToDuplicate} 1`);
  });

  test('Activate Profile', async () => {
    test.setTimeout(300000);
    await verifyProfileActivationFlow(false);
  });

  test('Activate Profile using action Button', async () => {
    test.setTimeout(300000);
    await verifyProfileActivationFlow(true);
  });

  test.skip('Delete profile using action Button', async () => {
    test.setTimeout(300000);
    await vscodeApp.deleteProfile(duplicatedProfileName);
  });

  test.afterAll(async () => {
    for (const profileStr of profilesToDelete) {
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
    profilesToDelete.push(profile1);
    await verifyProfileIsActive(vscodeApp, profileView, profile1, true);

    //Create second profile and verify activation swapped
    await vscodeApp.createProfile([], [], profile2);
    profilesToDelete.push(profile2);
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
});
