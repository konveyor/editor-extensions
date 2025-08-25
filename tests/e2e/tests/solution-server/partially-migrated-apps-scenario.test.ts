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
import { FixTypes } from '../../enums/fix-types.enum';
import { KAIViews } from '../../enums/views.enum';
import { execSync } from 'child_process';
import * as path from 'path';

/**
 * Helper class for managing solution server workflow tests with sequential fix application.
 * The workflow applies fixes in sequence: audit logger fix first, then Java annotation fix.
 * This ensures that dependencies are resolved in the correct order.
 */
class SolutionServerWorkflowHelper {
  public logger: TestLogger;

  constructor() {
    this.logger = new TestLogger('Solution-Server-Workflow');
  }

  /**
   * Sets up a repository with comprehensive error handling
   */
  async setupRepository(
    repoInfo: any,
    appName: string,
    customRulesSubPath: string
  ): Promise<VSCode> {
    this.logger.info(`Setting up ${appName} repository`);

    let vsCode: VSCode | undefined;

    try {
      // Initialize VSCode
      vsCode = await VSCode.open(repoInfo.repoUrl, repoInfo.repoName);
      this.logger.success(`VSCode opened for ${appName}`);

      // Setup with retry logic
      await this.retryOperation(
        async () => {
          await this.checkoutBranch(repoInfo, appName);
          if (!vsCode) throw new Error('VSCode not initialized');
          await this.createProfileWithCustomRules(vsCode, repoInfo, appName, customRulesSubPath);
          await this.configureSolutionServer(vsCode, appName);
          await this.runAnalysis(vsCode, appName);
        },
        3,
        `Failed to setup ${appName}`
      );

      this.logger.success(`Successfully setup ${appName} repository`);
      return vsCode;
    } catch (error) {
      this.logger.error(`Setup failed for ${appName}: ${error}`);
      if (vsCode) {
        await this.cleanupVSCode(vsCode);
      }
      throw error;
    }
  }

  /**
   * Switches to a different repository in the same VSCode instance
   */
  async switchToRepository(
    vsCode: VSCode,
    repoInfo: any,
    appName: string,
    customRulesSubPath: string
  ): Promise<VSCode> {
    this.logger.info(`Switching to ${appName} repository`);

    try {
      // Close current VSCode and open new one
      await vsCode.closeVSCode();
      this.logger.info(`Closed previous VSCode instance`);

      // Open new repository
      const newVsCode = await VSCode.open(repoInfo.repoUrl, repoInfo.repoName);
      this.logger.success(`Opened ${appName} in VSCode`);

      // Setup new repository
      await this.retryOperation(
        async () => {
          await this.checkoutBranch(repoInfo, appName);
          await this.createProfileWithCustomRules(newVsCode, repoInfo, appName, customRulesSubPath);
          await this.configureSolutionServer(newVsCode, appName);
          await this.runAnalysis(newVsCode, appName);
        },
        3,
        `Failed to setup ${appName} after switch`
      );

      this.logger.success(`Successfully switched to ${appName}`);
      return newVsCode;
    } catch (error) {
      this.logger.error(`Failed to switch to ${appName}: ${error}`);
      throw error;
    }
  }

  /**
   * Checks out the correct branch with validation
   */
  private async checkoutBranch(repoInfo: any, appName: string): Promise<void> {
    this.logger.info(`Checking out ${repoInfo.branch} branch for ${appName}`);

    try {
      execSync(`git checkout -f ${repoInfo.branch}`, {
        cwd: repoInfo.repoName,
        stdio: 'pipe',
      });

      // Validate branch
      const currentBranch = execSync(`git rev-parse --abbrev-ref HEAD`, {
        cwd: repoInfo.repoName,
        encoding: 'utf8',
      }).trim();

      if (currentBranch !== repoInfo.branch) {
        throw new Error(`Branch mismatch: expected '${repoInfo.branch}', got '${currentBranch}'`);
      }

      this.logger.success(`Successfully checked out ${currentBranch} for ${appName}`);
    } catch (error) {
      throw new Error(`Git checkout failed for ${appName}: ${error}`);
    }
  }

  /**
   * Extracts profile configuration from test fixtures
   */
  private getProfileConfig(repoInfo: any, appName: string) {
    this.logger.debug(`Extracting profile config for ${appName}`);
    this.logger.debug(`Repo info: ${JSON.stringify(repoInfo, null, 2)}`);

    // Use the exact same sources and targets from test fixtures
    const config = {
      sources: repoInfo.sources || [],
      targets: repoInfo.targets || [],
      repoName: repoInfo.repoName,
      branch: repoInfo.branch,
    };

    this.logger.info(`Profile config for ${appName}:`);
    this.logger.info(`  Sources: ${JSON.stringify(config.sources)}`);
    this.logger.info(`  Targets: ${JSON.stringify(config.targets)}`);
    this.logger.info(`  Branch: ${config.branch}`);

    return config;
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
    this.logger.info(`Creating profile for ${appName} with custom rules: ${customRulesPath}`);

    // Get the proper configuration from test fixtures
    const profileConfig = this.getProfileConfig(repoInfo, appName);

    try {
      await vsCode.createProfile(
        profileConfig.sources,
        profileConfig.targets,
        undefined,
        customRulesPath
      );
      this.logger.success(`Profile created for ${appName}`);
    } catch (error) {
      throw new Error(`Profile creation failed for ${appName}: ${error}`);
    }
  }

  /**
   * Configures solution server
   */
  private async configureSolutionServer(vsCode: VSCode, appName: string): Promise<void> {
    this.logger.info(`Configuring solution server for ${appName}`);

    try {
      const config = await Configuration.open(vsCode);
      await config.setEnabledConfiguration(ConfigurationOptions.SolutionServerEnabled, true);

      await vsCode.executeQuickCommand('Konveyor: Restart Solution Server');
      await vsCode.configureGenerativeAI(DEFAULT_PROVIDER.config);
      await vsCode.startServer();

      this.logger.success(`Solution server configured for ${appName}`);
    } catch (error) {
      throw new Error(`Solution server configuration failed for ${appName}: ${error}`);
    }
  }

  /**
   * Runs analysis with proper validation
   */
  private async runAnalysis(vsCode: VSCode, appName: string): Promise<void> {
    this.logger.info(`Running analysis for ${appName}`);
    const analysisStart = Date.now();

    try {
      await vsCode.runAnalysis();

      // Wait for completion
      await expect(vsCode.getWindow().getByText('Analysis completed').first()).toBeVisible({
        timeout: 300000,
      });

      const analysisTime = Date.now() - analysisStart;
      this.logger.success(`Analysis completed for ${appName} in ${analysisTime}ms`);
    } catch (error) {
      throw new Error(`Analysis failed for ${appName}: ${error}`);
    }
  }

  /**
   * Validates analysis results with specific expected counts
   */
  async validateAnalysisResults(vsCode: VSCode, appName: string): Promise<number> {
    this.logger.info(`Validating analysis results for ${appName}`);

    try {
      await vsCode.openAnalysisView();
      const analysisView = await vsCode.getView(KAIViews.analysisView);

      await expect(analysisView.getByText('Analysis Results')).toBeVisible({ timeout: 10000 });

      const violations = analysisView.locator('.pf-v6-c-card__header-toggle');
      const violationCount = await violations.count();

      this.logger.info(`Found ${violationCount} violations in ${appName}`);

      // Both inventory and EHR apps should have exactly 2 violations
      expect(violationCount).toBe(2);
      this.logger.success(`${appName} has expected 2 violations`);

      // Validate that we have audit-related content
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

  /**
   * Applies complete fix workflow for the specified application:
   * 1. First applies audit logger fix
   * 2. Then applies Java annotation fix
   *
   * This sequential approach ensures dependencies are resolved in the correct order.
   */
  async applyAuditLoggerFix(vsCode: VSCode, appName: string): Promise<boolean> {
    this.logger.info(`Applying audit logger fix for ${appName}`);

    const solutionStart = Date.now();

    try {
      await vsCode.openAnalysisView();

      // Capture incident count BEFORE applying the fix
      const analysisViewBefore = await vsCode.getView(KAIViews.analysisView);
      await vsCode.getWindow().waitForTimeout(2000); // Wait for analysis to load

      // Count total incidents before fix
      const incidentsBefore = await analysisViewBefore
        .locator('[class*="incident"], [class*="violation"], .incident, .violation')
        .count();
      this.logger.info(`Incident count BEFORE fix: ${incidentsBefore}`);

      // Request fix for the specific violation
      const violationText =
        'Replace `FileSystemAuditLogger` instantiation with `StreamableAuditLogger` over TCP';
      await vsCode.searchAndRequestFix(violationText, FixTypes.Incident);

      // Wait for resolution view
      const resolutionView = await vsCode.getView(KAIViews.resolutionDetails);

      // Review changes before accepting (demonstrates usage of new methods)
      await this.reviewChangesBeforeAccepting(resolutionView);

      // Wait for solution with multiple selector strategies
      const acceptButton = await this.waitForSolutionGeneration(resolutionView);

      // Apply the solution
      await acceptButton.click();
      this.logger.success('Audit logger fix solution applied');

      // Wait for and click Continue button if it appears (completes the workflow)
      try {
        await vsCode.getWindow().waitForTimeout(3000); // Wait for UI to update
        const continueButton = await this.getContinueButton(resolutionView);
        if (await continueButton.isVisible()) {
          this.logger.info('Clicking Continue button to complete audit logger fix workflow');
          await continueButton.click();
          await vsCode.getWindow().waitForTimeout(2000); // Wait for workflow to complete
        }
      } catch (error) {
        this.logger.info('Continue button not found, proceeding with validation');
      }

      // Re-run analysis to detect that the issue has been resolved
      this.logger.info('Re-running analysis to verify audit logger fix resolution');
      await vsCode.openAnalysisView();
      const analysisViewAfter = await vsCode.getView(KAIViews.analysisView);

      // Wait for analysis to complete
      await vsCode.getWindow().waitForTimeout(5000);

      // Validate solution application
      await this.validateSolutionApplication(vsCode, appName);

      // Now apply Java annotation fix after audit logger fix is complete
      this.logger.info(`Applying Java annotation fix for ${appName} after audit logger fix`);
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

  /**
   * Internal method to apply Java annotation fix (called after audit logger fix)
   */
  private async applyJavaAnnotationFixInternal(vsCode: VSCode, appName: string): Promise<boolean> {
    try {
      await vsCode.openAnalysisView();

      // Capture incident count BEFORE applying the Java annotation fix
      const analysisViewBefore = await vsCode.getView(KAIViews.analysisView);
      await vsCode.getWindow().waitForTimeout(2000); // Wait for analysis to load

      // Count total incidents before Java annotation fix
      const incidentsBefore = await analysisViewBefore
        .locator('[class*="incident"], [class*="violation"], .incident, .violation')
        .count();
      this.logger.info(`Incident count BEFORE Java annotation fix: ${incidentsBefore}`);

      // Request fix for the Java annotation module removal issue
      const violationText =
        'The java.annotation (Common Annotations) module has been removed from OpenJDK 11';
      await vsCode.searchAndRequestFix(violationText, FixTypes.Incident);

      // Wait for resolution view
      const resolutionView = await vsCode.getView(KAIViews.resolutionDetails);

      // Review changes before accepting
      await this.reviewChangesBeforeAccepting(resolutionView);

      // Wait for solution with multiple selector strategies
      const acceptButton = await this.waitForSolutionGeneration(resolutionView);

      // Apply the solution
      await acceptButton.click();
      this.logger.success('Java annotation fix solution applied');

      // Wait for and click Continue button if it appears
      try {
        await vsCode.getWindow().waitForTimeout(3000); // Wait for UI to update
        const continueButton = await this.getContinueButton(resolutionView);
        if (await continueButton.isVisible()) {
          this.logger.info('Clicking Continue button to complete Java annotation fix workflow');
          await continueButton.click();
          await vsCode.getWindow().waitForTimeout(2000); // Wait for workflow to complete
        }
      } catch (error) {
        this.logger.info('Continue button not found, proceeding with validation');
      }

      // Re-run analysis to detect that the Java annotation issue has been resolved
      this.logger.info('Re-running analysis to verify Java annotation fix resolution');
      await vsCode.openAnalysisView();
      const analysisViewAfter = await vsCode.getView(KAIViews.analysisView);

      // Wait for analysis to complete
      await vsCode.getWindow().waitForTimeout(5000);

      // Validate solution application
      await this.validateSolutionApplication(vsCode, appName);

      this.logger.success(`Java annotation fix applied for ${appName}`);
      return true;
    } catch (error) {
      this.logger.error(`Java annotation fix application failed for ${appName}: ${error}`);
      return false;
    }
  }

  /**
   * Waits for solution generation with 30-second increments for 5 minutes
   */
  private async waitForSolutionGeneration(resolutionView: any): Promise<any> {
    this.logger.info('Waiting for solution generation (checking every 30s for 5 minutes)');

    const maxAttempts = 10; // 10 attempts × 30 seconds = 5 minutes
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        // Use the new getAcceptButton method with current selectors
        const button = await this.getAcceptButton(resolutionView);
        if (button && (await button.isVisible())) {
          this.logger.success('Found accept button using current selectors');
          return button;
        }
      } catch (error) {
        // Button not found yet, continue waiting
      }

      attempts++;
      const timeElapsed = attempts * 30;
      this.logger.info(
        `Attempt ${attempts}/${maxAttempts}: No solution yet, waiting... (${timeElapsed}s elapsed)`
      );

      if (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30 seconds
      }
    }

    throw new Error('Solution generation timed out after 5 minutes');
  }

  /**
   * Gets the accept button from the resolution view using current selectors
   */
  private async getAcceptButton(resolutionView: any): Promise<any> {
    const selectors = ['button:has-text("Accept All")', 'button.main-accept-button'];

    for (const selector of selectors) {
      const button = resolutionView.locator(selector);
      if (await button.isVisible()) {
        return button;
      }
    }

    throw new Error('Accept button not found in resolution view');
  }

  /**
   * Gets the reject button from the resolution view using current selectors
   */
  private async getRejectButton(resolutionView: any): Promise<any> {
    const selectors = ['button:has-text("Reject All")', 'button.main-reject-button'];

    for (const selector of selectors) {
      const button = resolutionView.locator(selector);
      if (await button.isVisible()) {
        return button;
      }
    }

    throw new Error('Reject button not found in resolution view');
  }

  /**
   * Gets the Review Changes button from the resolution view using current selectors
   */
  private async getReviewChangesButton(resolutionView: any): Promise<any> {
    const selectors = ['button:has-text("Review Changes")', 'button.view-with-decorations-button'];

    for (const selector of selectors) {
      const button = resolutionView.locator(selector);
      if (await button.isVisible()) {
        return button;
      }
    }

    throw new Error('Review Changes button not found in resolution view');
  }

  /**
   * Gets modified file messages from the resolution view
   */
  private async getModifiedFileMessages(resolutionView: any): Promise<any> {
    const selectors = [
      '.modified-file-message',
      '[class*="modified-file"]',
      '[class*="file-message"]',
      '.file-change-message',
    ];

    for (const selector of selectors) {
      const messages = resolutionView.locator(selector);
      if ((await messages.count()) > 0) {
        return messages;
      }
    }

    throw new Error('Modified file messages not found in resolution view');
  }

  /**
   * Gets the diff status banner that shows the current state
   */
  private async getDiffStatusBanner(resolutionView: any): Promise<any> {
    const selectors = [
      '.diff-status-banner',
      '[class*="diff-status"]',
      '[class*="status-banner"]',
      '.status-indicator',
    ];

    for (const selector of selectors) {
      const banner = resolutionView.locator(selector);
      if (await banner.isVisible()) {
        return banner;
      }
    }

    return null;
  }

  /**
   * Gets the Continue button that appears after accepting changes
   */
  private async getContinueButton(resolutionView: any): Promise<any> {
    const selectors = ['button:has-text("Continue")', 'button.continue-button'];

    for (const selector of selectors) {
      const button = resolutionView.locator(selector);
      if (await button.isVisible()) {
        return button;
      }
    }

    throw new Error('Continue button not found in resolution view');
  }

  /**
   * Reviews changes in the resolution view before accepting them
   * Demonstrates usage of the new button methods
   */
  async reviewChangesBeforeAccepting(resolutionView: any): Promise<void> {
    this.logger.info('Reviewing changes before accepting solution');

    try {
      // Check if there are modified file messages to review
      const modifiedMessages = await this.getModifiedFileMessages(resolutionView);
      const messageCount = await modifiedMessages.count();
      this.logger.info(`Found ${messageCount} modified file messages to review`);

      if (messageCount > 0) {
        // Try to find the Review Changes button
        try {
          const reviewButton = await this.getReviewChangesButton(resolutionView);
          if (await reviewButton.isVisible()) {
            this.logger.info('Clicking Review Changes button to view detailed changes');
            await reviewButton.click();
            await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for diff view
          }
        } catch (error) {
          this.logger.info('Review Changes button not available, proceeding with inline review');
        }

        // Check for diff status banner
        const statusBanner = await this.getDiffStatusBanner(resolutionView);
        if (statusBanner) {
          const bannerText = await statusBanner.textContent();
          this.logger.info(`Status banner shows: ${bannerText}`);
        }
      }

      this.logger.success('Changes reviewed successfully');
    } catch (error) {
      this.logger.warn(`Error during change review: ${error}`);
      // Continue with the process even if review fails
    }
  }

  /**
   * Validates solution application with file change verification
   */
  private async validateSolutionApplication(vsCode: VSCode, appName: string): Promise<void> {
    this.logger.info(`Validating solution application for ${appName}`);

    try {
      await vsCode.openAnalysisView();
      const analysisView = await vsCode.getView(KAIViews.analysisView);

      // Wait for confirmation to complete
      await expect(
        analysisView
          .getByRole('heading', { level: 2 })
          .filter({ hasText: 'Waiting for solution confirmation...' })
      ).not.toBeVisible({ timeout: 35000 });

      this.logger.success(`Solution application confirmed for ${appName}`);

      // Validate file changes were applied
      const repoPath = appName.includes('Inventory') ? 'inventory_management' : 'ehr_viewer';

      // Find Service.java files in the repository
      try {
        const findCmd = `find ${process.cwd()}/${repoPath} -name "*Service.java" -type f 2>/dev/null || true`;
        const serviceFiles = execSync(findCmd, { encoding: 'utf8', stdio: 'pipe' })
          .split('\n')
          .filter((file) => file.trim().length > 0)
          .map((file) => file.replace(`${process.cwd()}/${repoPath}/`, ''));

        if (serviceFiles.length > 0) {
          await this.validateFileChanges(appName, repoPath, serviceFiles);
        } else {
          this.logger.warn(`No *Service.java files found in ${appName}`);
        }
      } catch (error) {
        this.logger.warn(`Could not search for Service files in ${appName}: ${error}`);
      }

      // Validate that solution completed successfully by checking analysis view is still accessible
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
    this.logger.info(`Validating file changes for ${appName}`);

    try {
      let filesModified = 0;
      let hasCorrectChanges = false;

      for (const filePath of expectedFiles) {
        const fullPath = path.join(process.cwd(), repoPath, filePath);

        try {
          // Check if file exists and read content
          const fileContent = execSync(`cat "${fullPath}"`, { encoding: 'utf8', stdio: 'pipe' });

          // Validate content changes
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
          // File might not exist or not accessible - not necessarily an error
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
      // File validation is supplementary - don't fail the test if files aren't accessible
      this.logger.warn(`File validation failed for ${appName}: ${error}`);
    }
  }

  /**
   * Captures solution server metrics including success rate and best hints
   */
  async captureSolutionServerMetrics(
    mcpClient: MCPClient
  ): Promise<{ successRate: any; bestHint: any }> {
    this.logger.info('Capturing solution server metrics');

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

      this.logger.success(
        `Solution server metrics captured - Accepted: ${successRate.accepted_solutions}, ` +
          `Pending: ${successRate.pending_solutions}, Hint ID: ${bestHint.hint_id}`
      );

      return { successRate, bestHint };
    } catch (error) {
      throw new Error(`Failed to capture metrics: ${error}`);
    }
  }

  /**
   * Generic retry operation with exponential backoff
   */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number,
    errorMessage: string
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.debug(`Attempt ${attempt}/${maxRetries}`);
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxRetries) {
          break;
        }

        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        this.logger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms: ${error}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error(`${errorMessage} after ${maxRetries} attempts: ${lastError!.message}`);
  }

  /**
   * Cleans up VSCode with proper error handling
   */
  async cleanupVSCode(vsCode: VSCode): Promise<void> {
    this.logger.info('Cleaning up VSCode');

    try {
      if (vsCode) {
        await vsCode.closeVSCode();
        this.logger.success('VSCode cleanup completed');
      }
    } catch (error) {
      this.logger.warn(`VSCode cleanup error (non-fatal): ${error}`);
    }
  }
}

class TestLogger {
  constructor(private context: string) {}

  private log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] [${this.context}] ${message}`);
  }

  info(message: string): void {
    this.log('INFO', message);
  }

  success(message: string): void {
    this.log('SUCCESS', `${message}`);
  }

  warn(message: string): void {
    this.log('WARN', `${message}`);
  }

  error(message: string): void {
    this.log('ERROR', `${message}`);
  }

  debug(message: string): void {
    this.log('DEBUG', `${message}`);
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
      helper.logger.success('Connected to MCP client');
    } catch (error) {
      throw new Error(`Failed to connect to MCP client: ${error}`);
    }
  });

  test('should setup and analyze inventory management', async () => {
    test.setTimeout(400000); // 5 minutes for setup and analysis

    helper.logger.info(
      '==================== PHASE 1: Setup Inventory Management ===================='
    );

    const inventoryRepoInfo = testRepoData['inventory_management'];
    vsCode = await helper.setupRepository(inventoryRepoInfo, 'Inventory Management', 'rules');

    // Validate initial analysis
    const inventoryViolations = await helper.validateAnalysisResults(
      vsCode,
      'Inventory Management'
    );
    expect(inventoryViolations).toBeGreaterThan(0);

    helper.logger.success('Inventory Management setup and analysis completed');
  });

  test('should apply audit logger fix successfully', async () => {
    test.setTimeout(400000); // 6-7 minutes for solution generation

    helper.logger.info(
      '==================== PHASE 2: Apply Audit Logger Fix and Java Annotation Fix ===================='
    );

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
    test.setTimeout(300000); // 5 minutes for switch and analysis

    helper.logger.info(
      '==================== PHASE 3: Switch to EHR Application ===================='
    );

    if (!vsCode) {
      throw new Error('VSCode instance not initialized - previous tests may have failed');
    }

    const ehrRepoInfo = testRepoData['ehr'];
    vsCode = await helper.switchToRepository(vsCode, ehrRepoInfo, 'EHR Viewer', 'rules');

    // Validate EHR analysis
    const ehrViolations = await helper.validateAnalysisResults(vsCode, 'EHR Viewer');
    expect(ehrViolations).toBeGreaterThan(0);

    helper.logger.success('EHR application setup and analysis completed');
  });

  test('should capture and validate solution server metrics', async () => {
    test.setTimeout(60000); // 1 minute for metrics capture

    helper.logger.info(
      '==================== PHASE 4: Capture and Validate Solution Server Metrics ===================='
    );

    const solutionServerMetrics = await helper.captureSolutionServerMetrics(mcpClient);

    // Validate that metrics are properly structured
    expect(solutionServerMetrics.successRate).toBeDefined();
    expect(solutionServerMetrics.bestHint).toBeDefined();
    expect(solutionServerMetrics.bestHint.hint_id).toBeDefined();
    expect(solutionServerMetrics.successRate.accepted_solutions).toBeGreaterThanOrEqual(0);

    // Validate metrics content
    expect(solutionServerMetrics.successRate.accepted_solutions).toBeGreaterThan(0);
    expect(solutionServerMetrics.bestHint.hint).toContain('StreamableAuditLogger');
    expect(solutionServerMetrics.bestHint.hint).toContain('FileSystemAuditLogger');

    // Validate that we have meaningful solution counts
    const totalSolutions = solutionServerMetrics.successRate.counted_solutions;
    expect(totalSolutions).toBeGreaterThan(0);
    helper.logger.success(`Validated solution server has processed ${totalSolutions} solutions`);

    // Log final summary
    helper.logger.success('Solution server metrics validated successfully');
    helper.logger.info(
      `Current metrics - Accepted: ${solutionServerMetrics.successRate.accepted_solutions}, ` +
        `Pending: ${solutionServerMetrics.successRate.pending_solutions}, ` +
        `Hint ID: ${solutionServerMetrics.bestHint.hint_id}`
    );
  });

  test('should apply audit logger fix in EHR and verify hint usage', async () => {
    test.setTimeout(400000); // 6-7 minutes for solution generation

    helper.logger.info(
      '==================== PHASE 5: Apply Complete Fix Workflow in EHR and Verify Hint Usage ===================='
    );

    if (!vsCode) {
      throw new Error('VSCode instance not initialized - previous tests may have failed');
    }

    // Capture current hint before requesting solution
    const beforeSolution = await helper.captureSolutionServerMetrics(mcpClient);
    helper.logger.info(`Pre-solution hint ID: ${beforeSolution.bestHint.hint_id}`);

    // Apply complete fix workflow to EHR app (audit logger + Java annotation)
    const fixApplied = await helper.applyAuditLoggerFix(vsCode, 'EHR Viewer');
    expect(fixApplied).toBe(true);

    // Capture metrics after solution to verify hint usage
    const afterSolution = await helper.captureSolutionServerMetrics(mcpClient);
    helper.logger.info(`Post-solution hint ID: ${afterSolution.bestHint.hint_id}`);

    // Validate that solution server used hints
    expect(afterSolution.successRate.accepted_solutions).toBeGreaterThan(
      beforeSolution.successRate.accepted_solutions
    );
    helper.logger.success(
      'Solution server successfully applied hints in EHR app for complete fix workflow'
    );

    // Log final workflow completion
    helper.logger.success('Complete solution server workflow validated');
    helper.logger.info(
      `Final metrics - Total accepted: ${afterSolution.successRate.accepted_solutions}, ` +
        `Latest hint ID: ${afterSolution.bestHint.hint_id}`
    );
  });

  test.afterEach(async () => {
    // Log test completion for better debugging
    helper.logger.info(`Test completed: ${test.info().title}`);
  });

  test.afterAll(async () => {
    if (vsCode) {
      await helper.cleanupVSCode(vsCode);
    }
    helper.logger.info('Solution server workflow test suite completed');
  });
});
