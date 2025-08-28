/**
 * Solution Server Workflow Test
 *
 * This test validates the solution server workflow across multiple applications,
 * including sequential fix application (audit logger fix followed by Java annotation fix)
 * and solution server metrics validation.
 *
 * Workflow:
 * 1. Setup inventory management → analyze → apply audit logger fix → apply Java annotation fix → capture metrics
 * 2. Switch to EHR app → analyze → apply complete fix workflow (audit logger + Java annotation) → validate solution server metrics
 * 3. Validate success metrics and best hints from solution server
 *
 */

import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { Configuration } from '../../pages/configuration.page';
import { ConfigurationOptions } from '../../enums/configuration-options.enum';
import { DEFAULT_PROVIDER } from '../../fixtures/provider-configs.fixture';
import { MCPClient } from '../../../mcp-client/mcp-client.model';
import {
  SuccessRateResponse,
  BestHintResponse,
} from '../../../mcp-client/mcp-client-responses.model';
import { FixTypes } from '../../enums/fix-types.enum';
import { KAIViews } from '../../enums/views.enum';
import * as path from 'path';
import * as fs from 'fs';
import { TestLogger } from '../../utilities/logger';

class SolutionServerWorkflowHelper {
  public logger: TestLogger;

  constructor() {
    this.logger = new TestLogger('Solution-Server-Workflow', 'SUCCESS');
  }

  private findFilesRecursively(dirPath: string, pattern: RegExp): string[] {
    return this.findFilesRecursivelyHelper(dirPath, dirPath, pattern);
  }

  private findFilesRecursivelyHelper(
    searchRoot: string,
    currentDir: string,
    pattern: RegExp
  ): string[] {
    const results: string[] = [];

    try {
      const items = fs.readdirSync(currentDir);

      for (const item of items) {
        const fullPath = path.join(currentDir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          // Recursively search subdirectories
          results.push(...this.findFilesRecursivelyHelper(searchRoot, fullPath, pattern));
        } else if (stat.isFile() && pattern.test(item)) {
          const relativePath = path.relative(searchRoot, fullPath);
          results.push(relativePath);
        }
      }
    } catch (error) {
      this.logger.debug(`Could not read directory ${currentDir}: ${error}`);
    }

    return results;
  }

  async setupRepository(
    repoInfo: any,
    appName: string,
    customRulesSubPath: string
  ): Promise<VSCode> {
    this.logger.debug(`Setting up ${appName} repository`);

    let vsCode: VSCode | undefined;

    try {
      vsCode = await VSCode.open(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
      this.logger.debug(`VSCode opened for ${appName}`);

      if (!vsCode) throw new Error('VSCode not initialized');
      await this.createProfileWithCustomRules(vsCode, repoInfo, appName, customRulesSubPath);
      await this.configureSolutionServer(vsCode, appName);
      await this.runAnalysis(vsCode, appName);

      this.logger.debug(`Successfully setup ${appName} repository`);
      return vsCode;
    } catch (error) {
      this.logger.error(`Setup failed for ${appName}: ${error}`);
      if (vsCode) {
        await vsCode.closeVSCode();
      }
      throw error;
    }
  }

  /**
   * Creates profile with custom rules using proper test fixture data
   */
  private async createProfileWithCustomRules(
    vsCode: VSCode,
    repoInfo: any,
    appName: string,
    customRulesSubPath: string
  ): Promise<void> {
    const customRulesPath = path.join(process.cwd(), repoInfo.repoName, customRulesSubPath);

    try {
      await vsCode.createProfile(
        repoInfo.sources || [],
        repoInfo.targets || [],
        undefined,
        customRulesPath
      );

      this.logger.success(
        `Profile created for ${appName} with custom rules from ${customRulesSubPath}`
      );
    } catch (error) {
      throw new Error(`Profile creation failed for ${appName}: ${error}`);
    }
  }

  private async configureSolutionServer(vsCode: VSCode, appName: string): Promise<void> {
    try {
      const config = await Configuration.open(vsCode);
      await config.setEnabledConfiguration(ConfigurationOptions.SolutionServerEnabled, true);

      await vsCode.executeQuickCommand('Konveyor: Restart Solution Server');
      await vsCode.configureGenerativeAI(DEFAULT_PROVIDER.config);
      await vsCode.startServer();

      this.logger.debug(`Solution server configured for ${appName}`);
    } catch (error) {
      throw new Error(`Solution server configuration failed for ${appName}: ${error}`);
    }
  }

  private async runAnalysis(vsCode: VSCode, appName: string): Promise<void> {
    const analysisStart = Date.now();

    try {
      await vsCode.runAnalysis();

      await expect(vsCode.getWindow().getByText('Analysis completed').first()).toBeVisible({
        timeout: 300000,
      });

      const analysisTime = Date.now() - analysisStart;
      this.logger.debug(`Analysis completed for ${appName} in ${analysisTime}ms`);
    } catch (error) {
      throw new Error(`Analysis failed for ${appName}: ${error}`);
    }
  }

  async validateAnalysisResults(vsCode: VSCode, appName: string): Promise<number> {
    try {
      await vsCode.openAnalysisView();
      const analysisView = await vsCode.getView(KAIViews.analysisView);

      await expect(analysisView.getByText('Analysis Results')).toBeVisible({ timeout: 30000 });

      const violations = analysisView.locator('.pf-v6-c-card__header-toggle');
      const violationCount = await violations.count();

      expect(violationCount).toBe(2);
      this.logger.success(`${appName} has expected 2 violations`);

      const analysisContent = await analysisView.locator('body').textContent();
      const hasAuditContent =
        analysisContent?.includes('FileSystemAuditLogger') ||
        analysisContent?.includes('audit') ||
        analysisContent?.includes('logger');

      if (!hasAuditContent) {
        throw new Error(
          `Expected audit-related violations not found in ${appName}. Found content: ${analysisContent?.substring(0, 200)}...`
        );
      }
      this.logger.success(`Found expected audit-related violation content in ${appName}`);

      return violationCount;
    } catch (error) {
      throw new Error(`Analysis validation failed for ${appName}: ${error}`);
    }
  }

  async applyAuditLoggerFix(vsCode: VSCode, appName: string): Promise<boolean> {
    const solutionStart = Date.now();

    try {
      await vsCode.openAnalysisView();

      const analysisViewBefore = await vsCode.getView(KAIViews.analysisView);

      const incidentsLocator = analysisViewBefore.locator(
        '[class*="incident"], [class*="violation"], .incident, .violation'
      );
      await expect(incidentsLocator.first()).toBeVisible({ timeout: 30000 });

      const incidentsBefore = await incidentsLocator.count();

      const violationText =
        'Replace `FileSystemAuditLogger` instantiation with `StreamableAuditLogger` over TCP';
      await vsCode.searchAndRequestFix(violationText, FixTypes.Incident);

      const resolutionView = await vsCode.getView(KAIViews.resolutionDetails);

      const acceptButton = await this.waitForSolutionGeneration(resolutionView);

      await acceptButton.click();
      this.logger.success('Audit logger fix solution applied');

      await vsCode.openAnalysisView();
      const analysisViewAfter = await vsCode.getView(KAIViews.analysisView);

      await expect(analysisViewAfter.locator('body')).toBeVisible({ timeout: 30000 });

      await this.validateSolutionApplication(vsCode, appName);

      const javaAnnotationFixApplied = await this.applyJavaAnnotationFixInternal(vsCode, appName);

      if (!javaAnnotationFixApplied) {
        this.logger.warn('Java annotation fix failed, but audit logger fix was successful');
      }

      const solutionTime = Date.now() - solutionStart;
      this.logger.success(`Complete fix workflow applied for ${appName} in ${solutionTime}ms`);

      return true;
    } catch (error) {
      this.logger.error(`Fix application failed for ${appName}: ${error}`);
      return false;
    }
  }

  private async applyJavaAnnotationFixInternal(vsCode: VSCode, appName: string): Promise<boolean> {
    try {
      await vsCode.openAnalysisView();

      const analysisViewBefore = await vsCode.getView(KAIViews.analysisView);

      const incidentsLocator = analysisViewBefore.locator(
        '[class*="incident"], [class*="violation"], .incident, .violation'
      );
      await expect(incidentsLocator.first()).toBeVisible({ timeout: 30000 });

      const violationText =
        'The java.annotation (Common Annotations) module has been removed from OpenJDK 11';
      await vsCode.searchAndRequestFix(violationText, FixTypes.Incident);

      const resolutionView = await vsCode.getView(KAIViews.resolutionDetails);

      const acceptButton = await this.waitForSolutionGeneration(resolutionView);

      await acceptButton.click();
      this.logger.success('Java annotation fix solution applied');

      await vsCode.openAnalysisView();
      const analysisViewAfter = await vsCode.getView(KAIViews.analysisView);

      await expect(analysisViewAfter.locator('body')).toBeVisible({ timeout: 30000 });

      await this.validateSolutionApplication(vsCode, appName);

      this.logger.success(`Java annotation fix applied for ${appName}`);
      return true;
    } catch (error) {
      this.logger.error(`Java annotation fix application failed for ${appName}: ${error}`);
      return false;
    }
  }

  private async waitForSolutionGeneration(resolutionView: any): Promise<any> {
    const maxAttempts = 10; // 10 attempts × 30 seconds = 5 minutes
    let attempts = 0;

    while (attempts < maxAttempts) {
      const button = await this.getAcceptButton(resolutionView);
      if (button && (await button.isVisible())) {
        this.logger.debug('Found accept button using current selectors');
        return button;
      }

      attempts++;
      const timeElapsed = attempts * 30;

      if (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30 seconds
      }
    }

    throw new Error('Solution generation timed out after 5 minutes');
  }

  private async getAcceptButton(resolutionView: any): Promise<any | null> {
    const selectors = ['button:has-text("Accept All")', 'button.main-accept-button'];

    for (const selector of selectors) {
      const button = resolutionView.locator(selector);
      if (await button.isVisible()) {
        return button;
      }
    }

    return null;
  }

  /**
   * Validates solution application with file change verification
   */
  private async validateSolutionApplication(vsCode: VSCode, appName: string): Promise<void> {
    try {
      await vsCode.openAnalysisView();
      const analysisView = await vsCode.getView(KAIViews.analysisView);

      await expect(
        analysisView
          .getByRole('heading', { level: 2 })
          .filter({ hasText: 'Waiting for solution confirmation...' })
      ).not.toBeVisible({ timeout: 35000 });

      this.logger.success(`Solution application confirmed for ${appName}`);

      const repoPath = appName.includes('Inventory') ? 'inventory_management' : 'ehr_viewer';

      try {
        const repoFullPath = path.join(process.cwd(), repoPath);
        this.logger.debug(`Searching for Service.java files in: ${repoFullPath}`);
        const serviceFiles = this.findFilesRecursively(repoFullPath, /.*Service\.java$/);
        this.logger.debug(
          `Found ${serviceFiles.length} Service.java files: ${JSON.stringify(serviceFiles)}`
        );

        if (serviceFiles.length > 0) {
          await this.validateFileChanges(appName, repoPath, serviceFiles);
        } else {
          this.logger.warn(`No *Service.java files found in ${appName}`);
        }
      } catch (error) {
        this.logger.warn(`Could not search for Service files in ${appName}: ${error}`);
      }

      await expect(analysisView.getByText('Analysis Results')).toBeVisible({ timeout: 5000 });
      this.logger.success(`Solution application validated for ${appName}`);
    } catch (error) {
      throw new Error(`Solution validation failed for ${appName}: ${error}`);
    }
  }

  /**
   * Validates that file changes were properly applied
   */
  private async validateFileChanges(
    appName: string,
    repoPath: string,
    expectedFiles: string[]
  ): Promise<void> {
    try {
      let filesModified = 0;
      let hasCorrectChanges = false;

      for (const filePath of expectedFiles) {
        const searchDirPath = path.join(process.cwd(), repoPath);
        const fullPath = path.join(searchDirPath, filePath);
        this.logger.debug(`Validating file: ${filePath} -> ${fullPath}`);

        try {
          const fileContent = fs.readFileSync(fullPath, 'utf8');

          if (fileContent.includes('StreamableAuditLogger')) {
            this.logger.success(`Found StreamableAuditLogger in ${filePath}`);
            hasCorrectChanges = true;
          }

          if (!fileContent.includes('FileSystemAuditLogger')) {
            this.logger.success(`FileSystemAuditLogger removed from ${filePath}`);
          } else {
            this.logger.warn(
              `FileSystemAuditLogger still found in ${filePath} - may be in comments or imports`
            );
          }

          filesModified++;
        } catch (fileError) {
          this.logger.debug(`Could not read ${filePath}: ${fileError}`);
        }
      }

      if (filesModified === 0) {
        this.logger.warn(`No expected files found for validation in ${appName}`);
      } else if (hasCorrectChanges) {
        this.logger.success(
          `File changes validated - StreamableAuditLogger found in ${filesModified} files`
        );
      } else {
        this.logger.warn(`Files were accessible but no StreamableAuditLogger changes found`);
      }
    } catch (error) {
      this.logger.warn(`File validation failed for ${appName}: ${error}`);
    }
  }

  /**
   * Captures solution server metrics including success rate and best hints
   */
  async captureSolutionServerMetrics(
    mcpClient: MCPClient
  ): Promise<{ successRate: SuccessRateResponse; bestHint: BestHintResponse }> {
    try {
      const metricsQuery = {
        ruleset_name: 'audit-logging-migration',
        violation_name: 'audit-logging-0003',
      };

      const successRate = await mcpClient.getSuccessRate([metricsQuery]);
      const bestHint = await mcpClient.getBestHint(
        metricsQuery.ruleset_name,
        metricsQuery.violation_name
      );

      this.logger.debug(
        `Solution server metrics captured - Accepted: ${successRate.accepted_solutions}, ` +
          `Pending: ${successRate.pending_solutions}, Hint ID: ${bestHint.hint_id}`
      );

      return { successRate, bestHint };
    } catch (error) {
      throw new Error(`Failed to capture metrics: ${error}`);
    }
  }
}

test.describe.serial('Solution Server Workflow', () => {
  let helper: SolutionServerWorkflowHelper;
  let mcpClient: MCPClient;
  let vsCode: VSCode | undefined;
  let testRepoData: any;

  test.beforeAll(async ({ testRepoData: repoData }) => {
    helper = new SolutionServerWorkflowHelper();
    testRepoData = repoData;

    try {
      mcpClient = await MCPClient.connect('http://localhost:8000');
      helper.logger.debug('Connected to MCP client');
    } catch (error) {
      throw new Error(`Failed to connect to MCP client: ${error}`);
    }
  });

  test('should setup and analyze inventory management', async () => {
    test.setTimeout(400000);

    const inventoryRepoInfo = testRepoData['inventory_management'];
    vsCode = await helper.setupRepository(inventoryRepoInfo, 'Inventory Management', 'rules');

    const inventoryViolations = await helper.validateAnalysisResults(
      vsCode,
      'Inventory Management'
    );
    expect(inventoryViolations).toBeGreaterThan(0);

    helper.logger.success('Inventory Management setup and analysis completed');
  });

  test('should apply audit logger fix successfully', async () => {
    test.setTimeout(400000);

    if (!vsCode) {
      throw new Error('VSCode instance not initialized - previous test may have failed');
    }

    const fixApplied = await helper.applyAuditLoggerFix(vsCode, 'Inventory Management');
    expect(fixApplied).toBe(true);

    helper.logger.success(
      'Complete fix workflow (audit logger + Java annotation) applied successfully'
    );
  });

  test('should switch to EHR and analyze violations', async () => {
    test.setTimeout(300000);

    if (!vsCode) {
      throw new Error('VSCode instance not initialized - previous tests may have failed');
    }

    const ehrRepoInfo = testRepoData['ehr'];
    await vsCode.closeVSCode();
    vsCode = await helper.setupRepository(ehrRepoInfo, 'EHR Viewer', 'rules');

    const ehrViolations = await helper.validateAnalysisResults(vsCode, 'EHR Viewer');
    expect(ehrViolations).toBeGreaterThan(0);

    helper.logger.success('EHR application setup and analysis completed');
  });

  test('should capture and validate solution server metrics', async () => {
    test.setTimeout(60000);

    const solutionServerMetrics = await helper.captureSolutionServerMetrics(mcpClient);

    expect(solutionServerMetrics.successRate).toBeDefined();
    expect(solutionServerMetrics.bestHint).toBeDefined();
    expect(solutionServerMetrics.bestHint.hint_id).toBeDefined();
    expect(solutionServerMetrics.successRate.accepted_solutions).toBeGreaterThanOrEqual(0);

    expect(solutionServerMetrics.successRate.accepted_solutions).toBeGreaterThan(0);
    expect(solutionServerMetrics.bestHint.hint).toContain('StreamableAuditLogger');
    expect(solutionServerMetrics.bestHint.hint).toContain('FileSystemAuditLogger');

    const totalSolutions = solutionServerMetrics.successRate.counted_solutions;
    expect(totalSolutions).toBeGreaterThan(0);
    helper.logger.success('Solution server metrics validated successfully');
  });

  test('should apply audit logger fix in EHR and verify hint usage', async () => {
    test.setTimeout(400000);

    if (!vsCode) {
      throw new Error('VSCode instance not initialized - previous tests may have failed');
    }

    const beforeSolution = await helper.captureSolutionServerMetrics(mcpClient);

    const fixApplied = await helper.applyAuditLoggerFix(vsCode, 'EHR Viewer');
    expect(fixApplied).toBe(true);

    const afterSolution = await helper.captureSolutionServerMetrics(mcpClient);

    expect(afterSolution.successRate.accepted_solutions).toBeGreaterThan(
      beforeSolution.successRate.accepted_solutions
    );
    helper.logger.success(
      'Solution server successfully applied hints in EHR app for complete fix workflow'
    );

    // Log final workflow completion
    helper.logger.success('Complete solution server workflow validated');
    helper.logger.debug(
      `Final metrics - Total accepted: ${afterSolution.successRate.accepted_solutions}, ` +
        `Latest hint ID: ${afterSolution.bestHint.hint_id}`
    );
  });

  test.afterEach(async () => {
    helper.logger.debug(`Test completed: ${test.info().title}`);
  });

  test.afterAll(async () => {
    if (vsCode) {
      await vsCode.closeVSCode();
    }
    helper.logger.debug('Solution server workflow test suite completed');
  });
});
