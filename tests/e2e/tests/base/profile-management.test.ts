import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { generateRandomString } from '../../utilities/utils';
import { KAIViews } from '../../enums/views.enum';
import { FrameLocator } from 'playwright';
import { ProfileActions } from '../../enums/profile-action-types.enum';
import * as VSCodeFactory from '../../utilities/vscode.factory';

test.describe(`Profile Tests`, { tag: ['@tier3'] }, () => {
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
    profileView = await vscodeApp.getView(KAIViews.manageProfiles);
  });

  test('Create empty Profile', async () => {
    const emptyProfileName = `emptyprofile-${generateRandomString()}`;
    await vscodeApp.createProfile([], [], emptyProfileName);
    await expect(profileView.getByText('Fix validation errors before continuing.')).toBeVisible();
    createdProfiles.push(emptyProfileName);
  });

  test('Create Profile and Set Sources targets and custom rules', async ({ testRepoData }) => {
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

  test('Create profile With Existing Name', async ({ testRepoData }) => {
    const existingProfileName = await getOrCreateProfile(testRepoData);
    const errorMessage = profileView.locator('.pf-m-error', {
      hasText: 'A profile with this name already exists.',
    });
    await profileView.getByRole('button', { name: '+ New Profile' }).click();
    await profileView.getByRole('textbox', { name: 'Profile Name' }).fill(existingProfileName);
    const sourceInput = profileView.getByRole('combobox', { name: 'Type to filter' }).nth(1);
    await sourceInput.click({ delay: 500 });
    await expect(errorMessage).toBeVisible();
    // Cleanup: deleting immediately to prevent afterAll cleanup from failing, when multiple profiles share the same name.
    const deleteButton = profileView.getByRole('button', { name: 'Delete Profile' });
    await deleteButton.waitFor({ state: 'visible', timeout: 10000 });
    // Ensures the button is clicked even if there are notifications overlaying it due to screen size
    await deleteButton.first().dispatchEvent('click');

    const confirmButton = profileView
      .getByRole('dialog', { name: 'Delete profile?' })
      .getByRole('button', { name: 'Confirm' });
    await confirmButton.waitFor({ state: 'visible', timeout: 10000 });
    await confirmButton.click();
  });

  test('Activate Profile', async () => {
    await verifyProfileActivationFlow(false);
  });

  test('Duplicate Profile using action button', async ({ testRepoData }) => {
    const profileToDuplicate = await getOrCreateProfile(testRepoData);
    await vscodeApp.doProfileMenuButtonAction(
      profileToDuplicate,
      ProfileActions.duplicateProfile,
      profileView
    );

    const duplicatedName = `${profileToDuplicate} 1`;
    await expect(profileView.getByText(duplicatedName)).toBeVisible({ timeout: 10000 });
    createdProfiles.unshift(duplicatedName);
  });

  test('Activate Profile using action Button', async () => {
    test.setTimeout(300000);
    await verifyProfileActivationFlow(true);
  });

  test('Remove Custom Rules from profile ', async ({ testRepoData }) => {
    if (createdProfiles.includes(profileNameWithRules)) {
      await vscodeApp.removeProfileCustomRules(profileNameWithRules, profileView);
    } else {
      const nameToUse = await getOrCreateProfile(testRepoData, true);
      await vscodeApp.removeProfileCustomRules(`${nameToUse} (active)`, profileView);
    }
  });

  // TODO: Remove skip once bug #565 is fixed.
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

  // Verifies the profile activation flow:
  // 1. Creates two profiles.
  // 2. Ensures the second one becomes active when created.
  // 3. Reactivates the first profile (either via action button or list).
  // 4. Confirms the activation state was swapped correctly.
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
      await vscodeApp.doProfileMenuButtonAction(
        profile1,
        ProfileActions.activateProfile,
        profileView
      );
    } else {
      await vscodeApp.activateProfile(profile1);
    }

    await verifyProfileIsActive(vscodeApp, profileView, profile1, true);

    console.log('Verified profile activation flow successfully');
  }

  async function getOrCreateProfile(testRepoData: any, withCustomRules = false): Promise<string> {
    const repoInfo = testRepoData['inventory_management'];
    const profileNamePrefix = withCustomRules ? 'customRulesProfile' : 'profile';
    const existingProfile = createdProfiles.find((name) => name.includes(profileNamePrefix));

    if (existingProfile) {
      return existingProfile;
    }

    const newProfile = `${profileNamePrefix}-${generateRandomString()}`;
    const customRules = withCustomRules ? repoInfo.customRulesFolder : undefined;
    await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, newProfile, customRules);
    createdProfiles.push(newProfile);
    return newProfile;
  }
});
