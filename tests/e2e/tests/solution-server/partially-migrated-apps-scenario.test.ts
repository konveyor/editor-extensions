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
import { HubConfigurationPage } from '../../pages/hub-configuration.page';
import {
  DEFAULT_PROVIDER,
  getDefaultProviderConfig,
  LLEMULATOR_PROVIDER,
} from '../../fixtures/provider-configs.fixture';
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
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { ResolutionAction } from '../../enums/resolution-action.enum';
import { getHubConfig } from '../../utilities/utils';
import pathlib from 'path';
import { SCREENSHOTS_FOLDER } from '../../utilities/consts';
import { buildKaiResponse, loadLlemulatorResponses } from '../../utilities/llemulator.utils';

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
      vsCode = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
      this.logger.debug(`VSCode opened for ${appName}`);

      const customRulesPath = path.join(process.cwd(), repoInfo.repoName, customRulesSubPath);
      await vsCode.createProfile(
        repoInfo.sources || [],
        repoInfo.targets || [],
        undefined,
        customRulesPath
      );
      await vsCode.getWindow().screenshot({
        path: pathlib.join(SCREENSHOTS_FOLDER, `proooofileeee.png`),
      });
      this.logger.success(
        `Profile created for ${appName} with custom rules from ${customRulesSubPath}`
      );
      await this.configureSolutionServer(vsCode, appName);
      await vsCode.runAnalysis();
      await vsCode.waitForAnalysisCompleted();
      await vsCode.getWindow().screenshot({
        path: pathlib.join(SCREENSHOTS_FOLDER, `aresult.png`),
      });
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

  private async configureSolutionServer(vsCode: VSCode, appName: string): Promise<void> {
    try {
      // Configure hub with solution server enabled
      const hubConfig = getHubConfig({
        profileSyncEnabled: false,
        solutionServerEnabled: true,
      });
      const hubConfigPage = await HubConfigurationPage.open(vsCode);
      await hubConfigPage.fillForm(hubConfig);

      await vsCode.assertNotification('Successfully connected to Hub solution server');

      await vsCode.configureGenerativeAI(getDefaultProviderConfig().config);
      await vsCode.startServer();

      this.logger.debug(`Solution server configured for ${appName}`);
    } catch (error) {
      throw new Error(`Solution server configuration failed for ${appName}: ${error}`);
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

  async applyAuditLoggerFix(vsCode: VSCode, appName: string): Promise<void> {
    await vsCode.openAnalysisView();
    const violationText =
      'Replace `FileSystemAuditLogger` instantiation with `StreamableAuditLogger` over TCP';
    await vsCode.searchAndRequestAction(violationText, FixTypes.Incident, ResolutionAction.Accept);
    this.logger.success('Audit logger fix solution applied');

    await vsCode.openAnalysisView();
    const analysisViewAfter = await vsCode.getView(KAIViews.analysisView);
    await expect(analysisViewAfter.locator('body')).toBeVisible({ timeout: 30000 });

    await this.validateSolutionApplication(vsCode, appName);
    await this.applyJavaAnnotationFixInternal(vsCode, appName);
  }

  private async applyJavaAnnotationFixInternal(vsCode: VSCode, appName: string): Promise<void> {
    await vsCode.openAnalysisView();
    const violationText =
      'The java.annotation (Common Annotations) module has been removed from OpenJDK 11';
    await vsCode.searchAndRequestAction(violationText, FixTypes.Incident, ResolutionAction.Accept);
    this.logger.success('Java annotation fix solution applied');

    await vsCode.openAnalysisView();
    const analysisViewAfter = await vsCode.getView(KAIViews.analysisView);
    await expect(analysisViewAfter.locator('body')).toBeVisible({ timeout: 30000 });

    await this.validateSolutionApplication(vsCode, appName);
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

      const successRate = await mcpClient.getSuccessRate(metricsQuery);
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

test.describe.serial(
  'Solution Server Workflow',
  { tag: ['@tier3', '@requires-minikube', '@slow'] },
  () => {
    let helper: SolutionServerWorkflowHelper;
    let mcpClient: MCPClient;
    let vsCode: VSCode | undefined;
    let testRepoData: any;

    test.beforeAll(async ({ testRepoData: repoData }) => {
      if (getDefaultProviderConfig() === LLEMULATOR_PROVIDER) {
        // Response for FileSystemAuditLogger -> StreamableAuditLogger fix (applied first)
        const auditLoggerFixResponse = buildKaiResponse({
          reasoning: 'Replacing FileSystemAuditLogger with StreamableAuditLogger for TCP streaming',
          language: 'java',
          fileContent: `package com.example.inventorymanagement.service;

import com.enterprise.audit.logging.config.AuditConfiguration;
import com.enterprise.audit.logging.exception.AuditLoggingException;
import com.enterprise.audit.logging.model.AuditEvent;
import com.enterprise.audit.logging.model.AuditResult;
import com.enterprise.audit.logging.service.StreamableAuditLogger;
import com.example.inventorymanagement.model.InventoryItem;
import com.example.inventorymanagement.model.InventoryRequest;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Service layer for medical device inventory management with audit logging v2.
 */
@Service
public class InventoryService {

    private StreamableAuditLogger auditLogger;
    private final Map<String, InventoryItem> inventory = new ConcurrentHashMap<>();

    @PostConstruct
    public void init() throws AuditLoggingException {

        if (auditLogger == null) {
            AuditConfiguration config = new AuditConfiguration();
            config.setLogDirectory("./device-inventory-audit-logs");
            config.setAutoCreateDirectory(true);
            auditLogger = new StreamableAuditLogger(config, "localhost", 9090);

        }

        // Initialize with some sample medical device inventory
        initializeSampleMedicalDevices();
    }

    @PreDestroy
    public void cleanup() throws AuditLoggingException {
        if (auditLogger != null) {
            auditLogger.close();
        }
    }

    private void initializeSampleMedicalDevices() {
        inventory.put("VENT-001", new InventoryItem("VENT-001", "Ventilator", 3, "Respiratory", "ICU Ward A", "Philips", "V60", "2025-12-31", "Available"));
        inventory.put("MONITOR-001", new InventoryItem("MONITOR-001", "Patient Monitor", 8, "Monitoring", "ER Department", "GE Healthcare", "B650", "2026-06-30", "Available"));
        inventory.put("DEFIB-001", new InventoryItem("DEFIB-001", "Defibrillator", 5, "Emergency", "Emergency Room", "Zoll", "X Series", "2025-09-15", "Available"));
        inventory.put("PUMP-001", new InventoryItem("PUMP-001", "Infusion Pump", 12, "Infusion", "Med-Surg Unit", "Baxter", "Sigma Spectrum", "2026-03-20", "Available"));
        inventory.put("XRAY-001", new InventoryItem("XRAY-001", "X-Ray Machine", 2, "Imaging", "Radiology", "Siemens", "Ysio Max", "2027-01-10", "Available"));
    }

    /**
     * Add medical devices to inventory (restock).
     */
    public InventoryItem addInventory(InventoryRequest request) throws AuditLoggingException {
        String deviceId = request.getDeviceId();
        int quantity = request.getQuantity();
        String userId = request.getUserId();
        String reason = request.getReason();
        String sessionId = UUID.randomUUID().toString();
        String correlationId = UUID.randomUUID().toString();

        InventoryItem item = inventory.get(deviceId);
        if (item == null) {
            // Device doesn't exist - log failure
            AuditEvent failureEvent = new AuditEvent(
                Instant.now(),
                "MEDICAL_DEVICE_ADD",
                userId,
                sessionId,
                "MedicalDeviceInventory",
                "InventoryService",
                "ADD",
                "medical-devices/" + deviceId,
                AuditResult.FAILURE,
                "Medical device not found: " + deviceId,
                null,
                correlationId,
                null,
                null
            );
            auditLogger.logEventAsync(failureEvent);
            throw new IllegalArgumentException("Medical device not found: " + deviceId);
        }

        // Update quantity
        int oldQuantity = item.getQuantity();
        item.setQuantity(oldQuantity + quantity);
        inventory.put(deviceId, item);

        // Log successful addition
        Map<String, Object> details = new HashMap<>();
        details.put("old_quantity", oldQuantity);
        details.put("added_quantity", quantity);
        details.put("new_quantity", item.getQuantity());
        details.put("reason", reason);
        details.put("patient_id", request.getPatientId());
        details.put("department", request.getDepartment());

        AuditEvent auditEvent = new AuditEvent(
            Instant.now(),
            "MEDICAL_DEVICE_ADD",
            userId,
            sessionId,
            "MedicalDeviceInventory",
            "InventoryService",
            "ADD",
            "medical-devices/" + deviceId,
            AuditResult.SUCCESS,
            "Added " + quantity + " units of " + item.getName(),
            details,
            correlationId,
            null,
            null
        );

        auditLogger.logEventAsync(auditEvent);

        return item;
    }

    /**
     * Remove medical devices from inventory (checkout/consume).
     */
    public InventoryItem removeInventory(InventoryRequest request) throws AuditLoggingException {
        String deviceId = request.getDeviceId();
        int quantity = request.getQuantity();
        String userId = request.getUserId();
        String reason = request.getReason();
        String sessionId = UUID.randomUUID().toString();
        String correlationId = UUID.randomUUID().toString();

        InventoryItem item = inventory.get(deviceId);
        if (item == null) {
            // Device doesn't exist - log failure
            AuditEvent failureEvent = new AuditEvent(
                Instant.now(),
                "MEDICAL_DEVICE_REMOVE",
                userId,
                sessionId,
                "MedicalDeviceInventory",
                "InventoryService",
                "REMOVE",
                "medical-devices/" + deviceId,
                AuditResult.FAILURE,
                "Medical device not found: " + deviceId,
                null,
                correlationId,
                null,
                null
            );
            auditLogger.logEventAsync(failureEvent);
            throw new IllegalArgumentException("Medical device not found: " + deviceId);
        }

        if (item.getQuantity() < quantity) {
            // Insufficient quantity - log failure
            AuditEvent failureEvent = new AuditEvent(
                Instant.now(),
                "MEDICAL_DEVICE_REMOVE",
                userId,
                sessionId,
                "MedicalDeviceInventory",
                "InventoryService",
                "REMOVE",
                "medical-devices/" + deviceId,
                AuditResult.FAILURE,
                "Insufficient quantity. Available: " + item.getQuantity() + ", Requested: " + quantity,
                null,
                correlationId,
                null,
                null
            );
            auditLogger.logEventAsync(failureEvent);
            throw new IllegalArgumentException("Insufficient quantity. Available: " + item.getQuantity() + ", Requested: " + quantity);
        }

        // Update quantity
        int oldQuantity = item.getQuantity();
        item.setQuantity(oldQuantity - quantity);
        inventory.put(deviceId, item);

        // Log successful removal
        Map<String, Object> details = new HashMap<>();
        details.put("old_quantity", oldQuantity);
        details.put("removed_quantity", quantity);
        details.put("new_quantity", item.getQuantity());
        details.put("reason", reason);
        details.put("patient_id", request.getPatientId());
        details.put("department", request.getDepartment());

        AuditEvent auditEvent = new AuditEvent(
            Instant.now(),
            "MEDICAL_DEVICE_REMOVE",
            userId,
            sessionId,
            "MedicalDeviceInventory",
            "InventoryService",
            "REMOVE",
            "medical-devices/" + deviceId,
            AuditResult.SUCCESS,
            "Removed " + quantity + " units of " + item.getName(),
            details,
            correlationId,
            null,
            null
        );

        auditLogger.logEventAsync(auditEvent);

        return item;
    }

    /**
     * Get medical device details.
     */
    public InventoryItem getInventory(String deviceId, String userId) throws AuditLoggingException {
        String sessionId = UUID.randomUUID().toString();
        String correlationId = UUID.randomUUID().toString();

        InventoryItem item = inventory.get(deviceId);

        if (item == null) {
            // Device not found - log failure
            AuditEvent failureEvent = new AuditEvent(
                Instant.now(),
                "MEDICAL_DEVICE_VIEW",
                userId,
                sessionId,
                "MedicalDeviceInventory",
                "InventoryService",
                "VIEW",
                "medical-devices/" + deviceId,
                AuditResult.FAILURE,
                "Medical device not found: " + deviceId,
                null,
                correlationId,
                null,
                null
            );
            auditLogger.logEventAsync(failureEvent);
            throw new IllegalArgumentException("Medical device not found: " + deviceId);
        }

        // Log successful view
        AuditEvent successEvent = new AuditEvent(
            Instant.now(),
            "MEDICAL_DEVICE_VIEW",
            userId,
            sessionId,
            "MedicalDeviceInventory",
            "InventoryService",
            "VIEW",
            "medical-devices/" + deviceId,
            AuditResult.SUCCESS,
            "User " + userId + " viewed medical device: " + item.getName(),
            null,
            correlationId,
            null,
            null
        );
        auditLogger.logEventAsync(successEvent);

        return item;
    }

    /**
     * Get all medical devices in inventory.
     */
    public Map<String, InventoryItem> getAllInventory(String userId) throws AuditLoggingException {
        String sessionId = UUID.randomUUID().toString();
        String correlationId = UUID.randomUUID().toString();

        // Log successful view of all inventory
        AuditEvent successEvent = new AuditEvent(
            Instant.now(),
            "MEDICAL_DEVICE_VIEW_ALL",
            userId,
            sessionId,
            "MedicalDeviceInventory",
            "InventoryService",
            "VIEW_ALL",
            "medical-devices",
            AuditResult.SUCCESS,
            "User " + userId + " viewed all medical device inventory items",
            null,
            correlationId,
            null,
            null
        );
        auditLogger.logEventAsync(successEvent);

        return new HashMap<>(inventory);
    }

    /**
     * Setter for audit logger (used in tests)
     */
    public void setAuditLogger(StreamableAuditLogger auditLogger) {
        this.auditLogger = auditLogger;
    }
}`,
        });

        // Response for javax.annotation -> jakarta.annotation fix (applied second)
        const javaAnnotationFixResponse = buildKaiResponse({
          reasoning:
            'Replacing javax.annotation with jakarta.annotation for OpenJDK 11+ compatibility',
          language: 'java',
          fileContent: `package com.example.inventorymanagement.service;

import com.enterprise.audit.logging.config.AuditConfiguration;
import com.enterprise.audit.logging.exception.AuditLoggingException;
import com.enterprise.audit.logging.model.AuditEvent;
import com.enterprise.audit.logging.model.AuditResult;
import com.enterprise.audit.logging.service.StreamableAuditLogger;
import com.example.inventorymanagement.model.InventoryItem;
import com.example.inventorymanagement.model.InventoryRequest;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Service layer for medical device inventory management with audit logging v2.
 */
@Service
public class InventoryService {

    private StreamableAuditLogger auditLogger;
    private final Map<String, InventoryItem> inventory = new ConcurrentHashMap<>();

    @PostConstruct
    public void init() throws AuditLoggingException {

        if (auditLogger == null) {
            AuditConfiguration config = new AuditConfiguration();
            config.setLogDirectory("./device-inventory-audit-logs");
            config.setAutoCreateDirectory(true);
            auditLogger = new StreamableAuditLogger(config, "localhost", 9090);

        }

        // Initialize with some sample medical device inventory
        initializeSampleMedicalDevices();
    }

    @PreDestroy
    public void cleanup() throws AuditLoggingException {
        if (auditLogger != null) {
            auditLogger.close();
        }
    }

    private void initializeSampleMedicalDevices() {
        inventory.put("VENT-001", new InventoryItem("VENT-001", "Ventilator", 3, "Respiratory", "ICU Ward A", "Philips", "V60", "2025-12-31", "Available"));
        inventory.put("MONITOR-001", new InventoryItem("MONITOR-001", "Patient Monitor", 8, "Monitoring", "ER Department", "GE Healthcare", "B650", "2026-06-30", "Available"));
        inventory.put("DEFIB-001", new InventoryItem("DEFIB-001", "Defibrillator", 5, "Emergency", "Emergency Room", "Zoll", "X Series", "2025-09-15", "Available"));
        inventory.put("PUMP-001", new InventoryItem("PUMP-001", "Infusion Pump", 12, "Infusion", "Med-Surg Unit", "Baxter", "Sigma Spectrum", "2026-03-20", "Available"));
        inventory.put("XRAY-001", new InventoryItem("XRAY-001", "X-Ray Machine", 2, "Imaging", "Radiology", "Siemens", "Ysio Max", "2027-01-10", "Available"));
    }

    /**
     * Add medical devices to inventory (restock).
     */
    public InventoryItem addInventory(InventoryRequest request) throws AuditLoggingException {
        String deviceId = request.getDeviceId();
        int quantity = request.getQuantity();
        String userId = request.getUserId();
        String reason = request.getReason();
        String sessionId = UUID.randomUUID().toString();
        String correlationId = UUID.randomUUID().toString();

        InventoryItem item = inventory.get(deviceId);
        if (item == null) {
            // Device doesn't exist - log failure
            AuditEvent failureEvent = new AuditEvent(
                Instant.now(),
                "MEDICAL_DEVICE_ADD",
                userId,
                sessionId,
                "MedicalDeviceInventory",
                "InventoryService",
                "ADD",
                "medical-devices/" + deviceId,
                AuditResult.FAILURE,
                "Medical device not found: " + deviceId,
                null,
                correlationId,
                null,
                null
            );
            auditLogger.logEventAsync(failureEvent);
            throw new IllegalArgumentException("Medical device not found: " + deviceId);
        }

        // Update quantity
        int oldQuantity = item.getQuantity();
        item.setQuantity(oldQuantity + quantity);
        inventory.put(deviceId, item);

        // Log successful addition
        Map<String, Object> details = new HashMap<>();
        details.put("old_quantity", oldQuantity);
        details.put("added_quantity", quantity);
        details.put("new_quantity", item.getQuantity());
        details.put("reason", reason);
        details.put("patient_id", request.getPatientId());
        details.put("department", request.getDepartment());

        AuditEvent auditEvent = new AuditEvent(
            Instant.now(),
            "MEDICAL_DEVICE_ADD",
            userId,
            sessionId,
            "MedicalDeviceInventory",
            "InventoryService",
            "ADD",
            "medical-devices/" + deviceId,
            AuditResult.SUCCESS,
            "Added " + quantity + " units of " + item.getName(),
            details,
            correlationId,
            null,
            null
        );

        auditLogger.logEventAsync(auditEvent);

        return item;
    }

    /**
     * Remove medical devices from inventory (checkout/consume).
     */
    public InventoryItem removeInventory(InventoryRequest request) throws AuditLoggingException {
        String deviceId = request.getDeviceId();
        int quantity = request.getQuantity();
        String userId = request.getUserId();
        String reason = request.getReason();
        String sessionId = UUID.randomUUID().toString();
        String correlationId = UUID.randomUUID().toString();

        InventoryItem item = inventory.get(deviceId);
        if (item == null) {
            // Device doesn't exist - log failure
            AuditEvent failureEvent = new AuditEvent(
                Instant.now(),
                "MEDICAL_DEVICE_REMOVE",
                userId,
                sessionId,
                "MedicalDeviceInventory",
                "InventoryService",
                "REMOVE",
                "medical-devices/" + deviceId,
                AuditResult.FAILURE,
                "Medical device not found: " + deviceId,
                null,
                correlationId,
                null,
                null
            );
            auditLogger.logEventAsync(failureEvent);
            throw new IllegalArgumentException("Medical device not found: " + deviceId);
        }

        if (item.getQuantity() < quantity) {
            // Insufficient quantity - log failure
            AuditEvent failureEvent = new AuditEvent(
                Instant.now(),
                "MEDICAL_DEVICE_REMOVE",
                userId,
                sessionId,
                "MedicalDeviceInventory",
                "InventoryService",
                "REMOVE",
                "medical-devices/" + deviceId,
                AuditResult.FAILURE,
                "Insufficient quantity. Available: " + item.getQuantity() + ", Requested: " + quantity,
                null,
                correlationId,
                null,
                null
            );
            auditLogger.logEventAsync(failureEvent);
            throw new IllegalArgumentException("Insufficient quantity. Available: " + item.getQuantity() + ", Requested: " + quantity);
        }

        // Update quantity
        int oldQuantity = item.getQuantity();
        item.setQuantity(oldQuantity - quantity);
        inventory.put(deviceId, item);

        // Log successful removal
        Map<String, Object> details = new HashMap<>();
        details.put("old_quantity", oldQuantity);
        details.put("removed_quantity", quantity);
        details.put("new_quantity", item.getQuantity());
        details.put("reason", reason);
        details.put("patient_id", request.getPatientId());
        details.put("department", request.getDepartment());

        AuditEvent auditEvent = new AuditEvent(
            Instant.now(),
            "MEDICAL_DEVICE_REMOVE",
            userId,
            sessionId,
            "MedicalDeviceInventory",
            "InventoryService",
            "REMOVE",
            "medical-devices/" + deviceId,
            AuditResult.SUCCESS,
            "Removed " + quantity + " units of " + item.getName(),
            details,
            correlationId,
            null,
            null
        );

        auditLogger.logEventAsync(auditEvent);

        return item;
    }

    /**
     * Get medical device details.
     */
    public InventoryItem getInventory(String deviceId, String userId) throws AuditLoggingException {
        String sessionId = UUID.randomUUID().toString();
        String correlationId = UUID.randomUUID().toString();

        InventoryItem item = inventory.get(deviceId);

        if (item == null) {
            // Device not found - log failure
            AuditEvent failureEvent = new AuditEvent(
                Instant.now(),
                "MEDICAL_DEVICE_VIEW",
                userId,
                sessionId,
                "MedicalDeviceInventory",
                "InventoryService",
                "VIEW",
                "medical-devices/" + deviceId,
                AuditResult.FAILURE,
                "Medical device not found: " + deviceId,
                null,
                correlationId,
                null,
                null
            );
            auditLogger.logEventAsync(failureEvent);
            throw new IllegalArgumentException("Medical device not found: " + deviceId);
        }

        // Log successful view
        AuditEvent successEvent = new AuditEvent(
            Instant.now(),
            "MEDICAL_DEVICE_VIEW",
            userId,
            sessionId,
            "MedicalDeviceInventory",
            "InventoryService",
            "VIEW",
            "medical-devices/" + deviceId,
            AuditResult.SUCCESS,
            "User " + userId + " viewed medical device: " + item.getName(),
            null,
            correlationId,
            null,
            null
        );
        auditLogger.logEventAsync(successEvent);

        return item;
    }

    /**
     * Get all medical devices in inventory.
     */
    public Map<String, InventoryItem> getAllInventory(String userId) throws AuditLoggingException {
        String sessionId = UUID.randomUUID().toString();
        String correlationId = UUID.randomUUID().toString();

        // Log successful view of all inventory
        AuditEvent successEvent = new AuditEvent(
            Instant.now(),
            "MEDICAL_DEVICE_VIEW_ALL",
            userId,
            sessionId,
            "MedicalDeviceInventory",
            "InventoryService",
            "VIEW_ALL",
            "medical-devices",
            AuditResult.SUCCESS,
            "User " + userId + " viewed all medical device inventory items",
            null,
            correlationId,
            null,
            null
        );
        auditLogger.logEventAsync(successEvent);

        return new HashMap<>(inventory);
    }

    /**
     * Setter for audit logger (used in tests)
     */
    public void setAuditLogger(StreamableAuditLogger auditLogger) {
        this.auditLogger = auditLogger;
    }
}`,
        });

        await loadLlemulatorResponses({
          reset: true,
          responses: [
            // First: FileSystemAuditLogger fix (pattern matches the violation text)
            {
              pattern: '.*FileSystemAuditLogger.*',
              response: auditLoggerFixResponse,
              times: -1,
            },
            // Second: javax.annotation fix (pattern matches the violation text)
            {
              pattern: '.*java\\.annotation.*|.*javax\\.annotation.*|.*OpenJDK 11.*',
              response: javaAnnotationFixResponse,
              times: -1,
            },
            // Fallback for any other requests
            {
              pattern: '.*',
              response: javaAnnotationFixResponse,
              times: -1,
            },
          ],
        });
      }

      helper = new SolutionServerWorkflowHelper();
      testRepoData = repoData;

      try {
        mcpClient = await MCPClient.connect();
        helper.logger.debug('Connected to MCP client');
      } catch (error) {
        throw new Error(`Failed to connect to MCP client: ${error}`);
      }
    });

    test('should setup and analyze inventory management', async () => {
      test.setTimeout(400000);

      const inventoryRepoInfo = testRepoData['inventory_management'];
      vsCode = await helper.setupRepository(inventoryRepoInfo, 'Inventory Management', 'rules');

      await helper.validateAnalysisResults(vsCode, 'Inventory Management');
      helper.logger.success('Inventory Management setup and analysis completed');
    });

    test('should apply audit logger fix successfully', async () => {
      test.setTimeout(400000);

      if (!vsCode) {
        throw new Error('VSCode instance not initialized - previous test may have failed');
      }

      await helper.applyAuditLoggerFix(vsCode, 'Inventory Management');

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

      await helper.applyAuditLoggerFix(vsCode, 'EHR Viewer');

      await expect
        .poll(
          async () => {
            const successRate = await mcpClient.getSuccessRate({
              ruleset_name: 'audit-logging-migration',
              violation_name: 'audit-logging-0003',
            });
            return successRate.accepted_solutions;
          },
          {
            message: 'make sure solution server metrics eventually gets updated',
            timeout: 10000,
          }
        )
        .toBeGreaterThan(beforeSolution.successRate.accepted_solutions);

      const afterSolution = await helper.captureSolutionServerMetrics(mcpClient);

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
  }
);
