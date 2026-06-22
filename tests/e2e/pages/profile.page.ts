import { FrameLocator } from 'playwright';
import { expect } from '@playwright/test';
import { VSCode } from './vscode.page';
import { generateRandomString } from '../utilities/utils';
import { KAIViews } from '../enums/views.enum';
import { ProfileActions } from '../enums/profile-action-types.enum';
import pathlib from 'path';
import { SCREENSHOTS_FOLDER } from '../utilities/consts';

export class ProfilePage {
  public constructor(private readonly vsCode: VSCode) {}

  public async getView() {
    return this.vsCode.getView(KAIViews.manageProfiles);
  }

  public async openManageProfiles() {
    await this.vsCode.executeQuickCommand(`${VSCode.COMMAND_CATEGORY}: Manage Analysis Profile`);
    return this.getView();
  }

  public async create(
    sources: string[],
    targets: string[],
    profileName?: string,
    customRulesPath?: string
  ) {
    await this.vsCode.executeQuickCommand(`${VSCode.COMMAND_CATEGORY}: Manage Analysis Profile`);

    const manageProfileView = await this.vsCode.getView(KAIViews.manageProfiles);

    await manageProfileView.getByRole('button', { name: '+ New Profile' }).click();

    const randomName = generateRandomString();
    const nameToUse = profileName ? profileName : randomName;
    await manageProfileView.getByRole('textbox', { name: 'Profile Name' }).fill(nameToUse);

    const targetsInput = manageProfileView
      .getByRole('combobox', { name: 'Type to filter' })
      .first();
    await targetsInput.click({ delay: 500 });

    for (const target of targets) {
      await targetsInput.fill(target);
      const existingOption = manageProfileView.getByRole('option', { name: target, exact: true });
      const createOption = manageProfileView.getByRole('option', {
        name: `Create new option "${target}"`,
      });

      if ((await existingOption.count()) > 0) {
        await existingOption.click({ timeout: 5000 });
      } else if ((await createOption.count()) > 0) {
        await createOption.click({ timeout: 5000 });
        console.log(`Created new target: ${target}`);
      } else {
        await this.vsCode.getWindow().waitForTimeout(1000);
        if ((await existingOption.count()) > 0) {
          await existingOption.click({ timeout: 5000 });
        } else if ((await createOption.count()) > 0) {
          await createOption.click({ timeout: 5000 });
          console.log(`Created new target: ${target}`);
        } else {
          throw new Error(`Could not find or create target: ${target}`);
        }
      }
    }
    await this.vsCode.getWindow().keyboard.press('Escape');

    const sourceInput = manageProfileView.getByRole('combobox', { name: 'Type to filter' }).nth(1);
    await sourceInput.click({ delay: 500 });

    for (const source of sources) {
      await sourceInput.fill(source);
      await manageProfileView
        .getByRole('option', { name: source, exact: true })
        .click({ timeout: 5000 });
    }
    await this.vsCode.getWindow().keyboard.press('Escape');

    if (customRulesPath) {
      await this.vsCode.selectCustomRules(customRulesPath);
    }
    return nameToUse;
  }

  public async delete(profileName: string) {
    try {
      console.log(`Attempting to delete profile: ${profileName}`);
      await this.vsCode.executeQuickCommand(`${VSCode.COMMAND_CATEGORY}: Manage Analysis Profile`);
      const manageProfileView = await this.vsCode.getView(KAIViews.manageProfiles);
      await expect(
        manageProfileView.getByText('Profile editing is temporarily disabled'),
        'Profile editing is still disabled after waiting for 1 minute'
      ).not.toBeVisible({ timeout: 60_000 });
      const profileList = manageProfileView.getByRole('list', {
        name: 'Profile list',
      });
      await profileList.waitFor({ state: 'visible', timeout: 30000 });

      const profileItems = profileList.getByRole('listitem');
      const targetProfile = profileItems.filter({ hasText: profileName });

      const profileCount = await targetProfile.count();
      if (profileCount === 0) {
        console.log(`Profile '${profileName}' not found in the list`);
        return;
      }
      await targetProfile.click({ timeout: 60000 });

      const deleteButton = manageProfileView.getByRole('button', { name: 'Delete Profile' });
      await deleteButton.waitFor({ state: 'visible', timeout: 10000 });
      await expect(deleteButton).toBeEnabled();
      await this.vsCode.getWindow().screenshot({
        path: pathlib.join(SCREENSHOTS_FOLDER, `last-profile-deletion.png`),
      });
      await deleteButton.first().dispatchEvent('click');

      const confirmButton = manageProfileView
        .getByRole('dialog', { name: 'Delete profile?' })
        .getByRole('button', { name: 'Confirm' });
      await confirmButton.waitFor({ state: 'visible', timeout: 10000 });
      await confirmButton.dispatchEvent('click');

      await manageProfileView
        .getByRole('listitem')
        .filter({ hasText: profileName })
        .waitFor({ state: 'hidden', timeout: 60_000 });

      console.log(`Profile '${profileName}' deleted successfully`);
    } catch (error) {
      console.log('Error deleting profile:', error);
      try {
        const manageProfileView = await this.vsCode.getView(KAIViews.manageProfiles);
        const profileList = manageProfileView.getByRole('list', { name: 'Profile list' });
        const profileItems = profileList.getByRole('listitem');
        const remainingProfile = profileItems.filter({ hasText: profileName });
        const remainingCount = await remainingProfile.count();

        if (remainingCount === 0) {
          console.log(`Profile '${profileName}' was actually deleted despite the error`);
          return;
        }
      } catch (checkError) {
        console.log('Could not verify profile deletion:', checkError);
      }
      throw error;
    }
  }

  public async getContainerByName(profileName: string, profileView: FrameLocator) {
    const profileList = profileView.getByRole('list', {
      name: 'Profile list',
    });
    await profileList.waitFor({ state: 'visible', timeout: 30000 });

    const targetProfile = profileList.locator(
      `//li[.//span[normalize-space() = "${profileName}" or normalize-space() = "${profileName} (active)"]]`
    );
    await expect(targetProfile).toHaveCount(1, { timeout: 60000 });
    return targetProfile;
  }

  public async clickOnContainer(profileName: string, profileView: FrameLocator) {
    const targetProfile = await this.getContainerByName(profileName, profileView);
    await targetProfile.click({ timeout: 60000 });
  }

  public async activate(profileName: string, profileView?: FrameLocator) {
    const pageView = profileView ? profileView : await this.vsCode.getView(KAIViews.manageProfiles);
    await this.clickOnContainer(profileName, pageView);
    const activationButton = pageView.getByRole('button', { name: 'Make Active' });
    await activationButton.waitFor({ state: 'visible', timeout: 10000 });
    await activationButton.click();
    const activeProfileButton = pageView.getByRole('button', { name: 'Active Profile' });
    await expect(activeProfileButton).toBeVisible({ timeout: 30000 });
    await expect(activeProfileButton).toBeDisabled({ timeout: 30000 });
  }

  public async doMenuAction(
    profileName: string,
    actionName: ProfileActions,
    profileView?: FrameLocator
  ) {
    let manageProfileView = profileView
      ? profileView
      : await this.vsCode.getView(KAIViews.manageProfiles);
    const targetProfile = await this.getContainerByName(profileName, manageProfileView);
    const kebabMenuButton = targetProfile.getByLabel('Profile actions menu');
    await kebabMenuButton.click();
    await manageProfileView.getByRole('menuitem', { name: actionName }).click();
    await this.vsCode.waitDefault();
    if (actionName === ProfileActions.deleteProfile) {
      const confirmButton = manageProfileView
        .getByRole('dialog', { name: 'Delete profile?' })
        .getByRole('button', { name: 'Confirm' });
      await confirmButton.click();
    }
  }

  public async removeCustomRules(profileName: string, pageView?: FrameLocator) {
    const profileView = pageView ? pageView : await this.vsCode.getView(KAIViews.manageProfiles);
    await this.clickOnContainer(profileName, profileView);
    const customRuleList = profileView.getByRole('list', { name: 'Custom Rules' });
    const removeButtons = customRuleList.getByRole('button', { name: 'Remove rule' });
    const rulesInList = await removeButtons.count();
    for (let i = 0; i < rulesInList; i++) {
      await removeButtons.first().click();
    }
    await expect(removeButtons).toHaveCount(0);
  }

  public async getActiveProfileName() {
    const view = await this.vsCode.getView(KAIViews.manageProfiles);
    const activeProfileLocator = view.locator('span:has(em:text-is("(active)"))');
    const fullText = await activeProfileLocator.textContent();
    if (fullText == null) {
      throw new Error('No active profile found');
    }

    return fullText.replace('(active)', '').trim();
  }
}
