import * as pathlib from 'path';
import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { OPENAI_GPT4O_PROVIDER } from '../../fixtures/provider-configs.fixture';
import * as fs from 'fs/promises';
import { generateRandomString } from '../../utilities/utils';
import { extractZip } from '../../utilities/archive';

test.describe(`Configure extension and run analysis`, () => {
  let vscodeApp: VSCode;
  const randomString = generateRandomString();
  const profileName = `automation-${randomString}`;

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(600000);
    const repoInfo = testRepoData['coolstore'];
    vscodeApp = await VSCode.open(repoInfo.repoUrl, repoInfo.repoName);
  });

  test('Create Profile and Set Sources and targets', async ({ testRepoData }) => {
    await vscodeApp.waitDefault();
    const repoInfo = testRepoData['coolstore'];
    await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, profileName);
  });

  test('Configure GenAI Provider', async () => {
    await vscodeApp.configureGenerativeAI(OPENAI_GPT4O_PROVIDER.config);
  });

  test('Start server', async () => {
    await vscodeApp.startServer();
  });

  test('Analyze coolstore app', async () => {
    await vscodeApp.waitDefault();
    await vscodeApp.runAnalysis();
    await vscodeApp.waitDefault();
    await expect(vscodeApp.getWindow().getByText('Analysis completed').first()).toBeVisible({
      timeout: 400000,
    });
  });

  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const isAscending = (arr: string[]) =>
    arr.every((v, i, a) => i === 0 || collator.compare(a[i - 1], v) <= 0);

  /**
   * Checks that the issues list is sorted correctly in both ascending and descending order.
   * Verifies that the descending order is not ascending, and ascending order is sorted.
   */
  test('Set list kind and sort (Issues ascending and descending)', async () => {
    await vscodeApp.setListKindAndSort('issues', 'ascending');
    const namesAscending = await vscodeApp.getListNames('issues');
    expect(isAscending(namesAscending)).toBe(true);

    await vscodeApp.setListKindAndSort('issues', 'descending');
    const namesDescending = await vscodeApp.getListNames('issues');
    expect(isAscending(namesDescending)).toBe(false);
    expect(namesDescending).toEqual([...namesAscending].reverse());
  });

  /**
   * Checks that the files list is sorted correctly in both ascending and descending order.
   * Also validates that all file names look valid.
   */
  test('Set list kind and sort (Files ascending and descending)', async () => {
    await vscodeApp.setListKindAndSort('files', 'ascending');
    const filesAscending = await vscodeApp.getListNames('files');
    expect(isAscending(filesAscending)).toBe(true);

    await vscodeApp.setListKindAndSort('files', 'descending');
    const filesDescending = await vscodeApp.getListNames('files');
    expect(isAscending(filesDescending)).toBe(false);
    expect(filesDescending).toEqual([...filesAscending].reverse());
  });

  /**
   * Tests the search functionality for files.
   * Searches for a specific file, checks that only one result is shown,
   * then clears the search and checks that multiple files are shown again.
   */
  test('Files: search narrows to one; clearing expands again', async () => {
    await vscodeApp.setListKindAndSort('files', 'ascending');
    const all = await vscodeApp.getListNames('files');
    expect(all.length).toBeGreaterThan(0);
    const filename = all[0];
    await vscodeApp.searchViolation(filename);
    await expect.poll(async () => (await vscodeApp.getListNames('files')).length).toBe(1);

    const names1 = await vscodeApp.getListNames('files');
    expect(names1).toEqual([filename]);
    await vscodeApp.searchViolation('');
    const names2 = await vscodeApp.getListNames('files');
    expect(names2.length).toBeGreaterThan(1);
  });

  const CATEGORY_NAMES = ['Potential', 'Optional', 'Mandatory'] as const;

  /**
   * Ensures that filtering issues by category never results in more issues than the baseline (unfiltered) count.
   * Iterates through all categories, applies each filter, and checks the count.
   * Cleans up by clearing all category selections at the end.
   */
  test('Category never exceeds number of incidents for Issues', async () => {
    await vscodeApp.setListKindAndSort('issues', 'ascending');
    await vscodeApp.searchViolation('');

    const baseline = (await vscodeApp.getListNames('issues')).length;
    expect(baseline).toBeGreaterThan(0);

    let totalNumberOfIssues = 0;

    for (const name of CATEGORY_NAMES) {
      await vscodeApp.setCategoryByName(name);
      const issuesCount = (await vscodeApp.getListNames('issues')).length;
      totalNumberOfIssues += issuesCount;
      await vscodeApp.setCategoryByName(name);
    }
    expect(totalNumberOfIssues).toBe(baseline);
  });

  test('Generate debug archive', async ({ testRepoData }) => {
    await vscodeApp.executeQuickCommand('Konveyor: Generate Debug Archive');
    await vscodeApp.waitDefault();
    const zipPathInput = vscodeApp
      .getWindow()
      .getByPlaceholder('Enter the path where the debug archive will be saved');
    expect(await zipPathInput.count()).toEqual(1);
    await zipPathInput.fill(pathlib.join('.vscode', 'debug-archive.zip'));
    await vscodeApp.getWindow().keyboard.press('Enter');
    await vscodeApp.waitDefault();
    const redactProviderConfigInput = vscodeApp
      .getWindow()
      .getByText(
        'Select provider settings values you would like to include in the archive, all other values will be redacted'
      );
    expect(await redactProviderConfigInput.count()).toEqual(1);
    await vscodeApp.getWindow().keyboard.press('Enter');
    await vscodeApp.waitDefault();
    const includeLLMTracesPrompt = vscodeApp.getWindow().getByText('Include LLM traces?');
    if ((await includeLLMTracesPrompt.count()) === 1) {
      await vscodeApp.getWindow().keyboard.press('Enter');
      await vscodeApp.waitDefault();
    }
    const zipPath = pathlib.join(
      testRepoData['coolstore'].repoName,
      '.vscode',
      'debug-archive.zip'
    );
    const zipStat = await fs.stat(zipPath);
    expect(zipStat.isFile()).toBe(true);
    const extractedPath = pathlib.join(testRepoData['coolstore'].repoName, '.vscode');
    extractZip(zipPath, extractedPath);
    const logsPath = pathlib.join(extractedPath, 'logs', 'extension.log');
    const logsStat = await fs.stat(logsPath);
    expect(logsStat.isFile()).toBe(true);
  });

  test('delete profile', async () => {
    await vscodeApp.deleteProfile(profileName);
  });

  test.afterAll(async () => {
    await vscodeApp.closeVSCode();
  });
});
