import { expect, Page } from '@playwright/test';
import { OutputChannel } from '../enums/output.enum';
import { VSCode } from './vscode.page';

export class OutputPanel {
  private static instance: OutputPanel;
  private readonly vsCode: VSCode;
  private readonly window: Page;
  private outputOpened: boolean = false;

  private constructor(vsCode: VSCode) {
    this.vsCode = vsCode;
    this.window = vsCode.getWindow();
  }

  public static getInstance(vsCode: VSCode): OutputPanel {
    return (OutputPanel.instance ??= new OutputPanel(vsCode));
  }

  /**
   * Opens the output view for a given channel.
   * @param channel - The channel to open.
   * @param filterText - The text to filter the output.
   */
  public async openOutputView(channel: OutputChannel, filterText?: string): Promise<void> {
    console.log(`Opening output view for channel: [${channel}]`);
    if (this.outputOpened) {
      console.log(`Output view already opened for channel: [${channel}]`);
      return;
    }
    await this.vsCode.executeQuickCommand(`Output: Show Output Channels...`);
    await this.window.locator('div.quick-input-list').getByText(channel).first().click();

    if (filterText) {
      await this.window.getByPlaceholder('Filter').fill(filterText);
      console.log(`Filter text filled: [${filterText}]`);
    }

    this.outputOpened = true;
  }

  /**
   * Closes the output view.
   */
  public async closeOutputView(): Promise<void> {
    console.log(`Closing output view`);
    if (!this.outputOpened) {
      console.log(`Output view already closed`);
      return;
    }
    const closeBtn = this.window.getByRole('button', { name: /Hide Panel \(Ctrl\+J\)/i });
    if (await closeBtn.count()) {
      await closeBtn.first().click();
    } else {
      await this.window.keyboard.press('Control+J');
    }
    console.log(`Output view closed`);
    this.outputOpened = false;
  }

  /**
   * Gets the content of the output channel.
   * @param channel - The channel to get the content from.
   * @param filterText - The text to filter the content.
   * @returns The content of the output channel.
   */
  public async getOutputChannelContent(
    channel: OutputChannel,
    filterText?: string
  ): Promise<string> {
    await this.openOutputView(channel, filterText);
    await this.window.locator('li[role="tab"].action-item.checked a:has-text("Output")').waitFor();

    const rawContent = await this.window.locator('div.view-lines').first().textContent();

    return rawContent ?? '';
  }

  /**
   * Gets the content of the output channel by regex.
   * @param channel - The channel to get the content from.
   * @param regex - The regex to match the content.
   * @returns The content of the output channel.
   */
  public async getOutputChannelContentByRegex(
    channel: OutputChannel,
    regex: RegExp
  ): Promise<string> {
    const content = await this.getOutputChannelContent(channel);
    const globalRegex = new RegExp(
      regex.source,
      regex.flags.includes('g') ? regex.flags : regex.flags + 'g'
    );
    const matches = content.match(globalRegex);
    return matches ? matches.join('\n') : '';
  }

  /**
   * Clears the output channel.
   */
  public async clearOutputChannel() {
    const outputActions = await this.window.getByRole('toolbar', { name: 'Output actions' });
    await expect(outputActions).toBeVisible();
    const clearOutput = outputActions.locator('a[aria-label="Clear Output"]');
    await expect(clearOutput).toBeVisible();
    await clearOutput.click();
    console.log(`Cleared output channel`);
    await this.window.waitForTimeout(1000);
  }
}
