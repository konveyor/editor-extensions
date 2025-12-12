import { Logger } from "winston";
import * as glob from "glob";
import * as tar from "tar";
import * as path from "path";
import * as fs from "fs/promises";
import * as yaml from "js-yaml";
import * as os from "os";
import type { RepositoryInfo } from "../utilities/git";
import { buildLabelSelectorFromLabels } from "@editor-extensions/shared";

export interface HubApplication {
  id: number;
  name: string;
  description?: string;
  createUser?: string;
  updateUser?: string;
  createTime?: string;
  repository?: {
    url: string;
    branch?: string;
    path?: string;
  };
}

export interface HubProfile {
  id: number;
  name: string;
  description?: string;
  createUser?: string;
  createTime?: string;
}

export interface SyncResult {
  success: boolean;
  profilesFound: number;
  profilesSynced: number;
  error?: string;
}

export interface LLMProxyConfig {
  available: boolean;
  endpoint: string; // e.g., "https://hub.example.com/llm-proxy/v1"
  model?: string; // Model name from Hub configuration
}

export interface HubProfileMetadata {
  hubProfileId: number;
  applicationId: number;
  syncedAt: string;
  isHubManaged: true;
}

export class ProfileSyncClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileSyncClientError";
  }
}

/**
 * Client for syncing analysis profiles from Konveyor Hub.
 * Handles profile discovery, download, and extraction.
 */
export class ProfileSyncClient {
  private baseUrl: string;
  private bearerToken: string | null;
  private logger: Logger;
  public isConnected: boolean = false;
  private llmProxyConfig: LLMProxyConfig | null = null;

  constructor(baseUrl: string, bearerToken: string | null, logger: Logger) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    this.bearerToken = bearerToken;
    this.logger = logger.child({
      component: "ProfileSyncClient",
    });
  }

  /**
   * Connect to the Hub (verify connectivity and discover LLM proxy)
   */
  public async connect(): Promise<void> {
    try {
      // Simple connectivity check - try to access the base Hub API
      const response = await fetch(`${this.baseUrl}/hub/applications`, {
        method: "HEAD",
        headers: this.getHeaders(),
      });

      if (!response.ok && response.status !== 404) {
        // 404 is ok - just means no applications, but Hub is reachable
        throw new ProfileSyncClientError(
          `Hub connectivity check failed: ${response.status} ${response.statusText}`,
        );
      }

      this.isConnected = true;
      this.logger.info("Profile sync client connected to Hub");

      // Discover LLM proxy as part of profile sync connection
      await this.discoverLLMProxy();
    } catch (error) {
      this.isConnected = false;
      this.logger.error("Failed to connect profile sync client", error);
      throw new ProfileSyncClientError(
        `Failed to connect to Hub: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Discover LLM proxy configuration from Hub.
   * Only 404 means "not configured" - all other responses/errors mean we should use the proxy.
   */
  private async discoverLLMProxy(): Promise<void> {
    // Fetch the JSON config directly to avoid parsing ConfigMap structure
    const configUrl = `${this.baseUrl}/hub/configmaps/llm-proxy-client/config.json`;

    try {
      this.logger.debug("Fetching LLM proxy configuration", { configUrl });

      const response = await fetch(configUrl, {
        method: "GET",
        headers: this.getHeaders("application/json"),
      });

      // 404 means the proxy is not configured
      if (response.status === 404) {
        this.logger.info("LLM proxy not configured (404)");
        this.llmProxyConfig = {
          available: false,
          endpoint: `${this.baseUrl}/llm-proxy/v1`,
        };
        return;
      }

      if (!response.ok) {
        this.logger.warn("LLM proxy configuration fetch failed", {
          status: response.status,
          statusText: response.statusText,
        });
        this.llmProxyConfig = {
          available: false,
          endpoint: `${this.baseUrl}/llm-proxy/v1`,
        };
        return;
      }

      // Successfully fetched configuration
      // The Hub API returns the config.json content as a JSON-encoded string,
      // so we need to parse it twice: once from the response, once from the string
      const rawConfig = await response.json();
      const config: { model?: string } =
        typeof rawConfig === "string" ? JSON.parse(rawConfig) : rawConfig;
      this.logger.info("LLM proxy configuration fetched successfully", {
        model: config.model,
      });

      // Use external Hub URL with /llm-proxy/v1 path
      this.llmProxyConfig = {
        available: true,
        endpoint: `${this.baseUrl}/llm-proxy/v1`,
        model: typeof config.model === "string" ? config.model : undefined,
      };

      this.logger.info("LLM proxy discovered and available", {
        endpoint: this.llmProxyConfig.endpoint,
        model: this.llmProxyConfig.model,
      });
    } catch (error) {
      // Network or parsing error - treat as not available
      this.logger.warn("LLM proxy configuration fetch threw error", error);
      this.llmProxyConfig = {
        available: false,
        endpoint: `${this.baseUrl}/llm-proxy/v1`,
      };
    }
  }

  /**
   * Get LLM proxy configuration if available
   */
  public getLLMProxyConfig(): LLMProxyConfig | undefined {
    return this.llmProxyConfig?.available ? this.llmProxyConfig : undefined;
  }

  /**
   * Disconnect from the Hub
   */
  public async disconnect(): Promise<void> {
    this.isConnected = false;
    this.logger.info("Profile sync client disconnected");
  }

  /**
   * Update the bearer token.
   * This is called after token refresh to ensure future requests use the new token.
   */
  public updateBearerToken(newToken: string): void {
    this.logger.info("Updating bearer token");
    this.bearerToken = newToken;
  }

  /**
   * Sync profiles for the given repository
   */
  public async syncProfiles(repoInfo: RepositoryInfo, syncDir: string): Promise<SyncResult> {
    if (!this.isConnected) {
      throw new ProfileSyncClientError("Profile sync client is not connected");
    }

    try {
      this.logger.info("Starting profile sync", {
        repositoryRoot: repoInfo.repositoryRoot,
        currentBranch: repoInfo.currentBranch,
        remoteUrl: repoInfo.remoteUrl,
        workspaceRelativePath: repoInfo.workspaceRelativePath,
      });

      // 1. Find application matching workspace
      const application = await this.findApplicationForWorkspace(repoInfo);

      if (!application) {
        return {
          success: false,
          profilesFound: 0,
          profilesSynced: 0,
          error: "No application found for repository",
        };
      }

      this.logger.info("Found application", {
        applicationId: application.id,
        applicationName: application.name,
      });

      // 2. List profiles for the application
      const profiles = await this.listProfilesForApplication(application.id);

      this.logger.info(`Found ${profiles.length} profiles for application`);

      if (profiles.length === 0) {
        return {
          success: true,
          profilesFound: 0,
          profilesSynced: 0,
        };
      }

      // 3. Download and extract each profile
      let syncedCount = 0;
      for (const profile of profiles) {
        try {
          await this.downloadAndExtractProfile(profile.id, application.id, syncDir);
          syncedCount++;
          this.logger.info(`Synced profile ${profile.id}: ${profile.name}`);
        } catch (error) {
          this.logger.error(`Failed to sync profile ${profile.id}`, error);
          // Continue with other profiles
        }
      }

      return {
        success: true,
        profilesFound: profiles.length,
        profilesSynced: syncedCount,
      };
    } catch (error) {
      this.logger.error("Profile sync failed", error);
      throw error;
    }
  }

  /**
   * Generate URL variations to try when searching for an application
   * Hub might store URLs with different schemes and .git suffix combinations.
   * We try common git URL schemes: ssh, https, http, git
   *
   * For example, if normalizedUrl is "github.com/org/repo", we generate:
   * - github.com/org/repo
   * - github.com/org/repo.git
   * - git@github.com:org/repo (SSH shorthand with colon)
   * - git@github.com:org/repo.git
   * - ssh://git@github.com/org/repo
   * - ssh://git@github.com/org/repo.git
   * - https://github.com/org/repo
   * - https://github.com/org/repo.git
   * - http://github.com/org/repo
   * - http://github.com/org/repo.git
   * - git://github.com/org/repo
   * - git://github.com/org/repo.git
   */
  private generateUrlVariations(normalizedUrl: string): string[] {
    const variations: string[] = [];

    // Base normalized URL (no scheme, no .git)
    const base = normalizedUrl.replace(/\.git$/, "");

    // Common git URL schemes
    const schemes = ["ssh://git@", "https://", "http://", "git://"];

    // For each scheme, try with and without .git suffix
    // Also include variations without any scheme
    for (const scheme of ["", ...schemes]) {
      variations.push(`${scheme}${base}`);
      variations.push(`${scheme}${base}.git`);
    }

    // Also try SSH shorthand format: git@host:path (common format used by git clone)
    // Convert "github.com/org/repo" to "git@github.com:org/repo"
    const parts = base.split("/");
    if (parts.length >= 2) {
      const host = parts[0];
      const path = parts.slice(1).join("/");
      variations.push(`git@${host}:${path}`);
      variations.push(`git@${host}:${path}.git`);
    }

    return variations;
  }

  /**
   * Fetch all applications from Hub and filter locally by repository URL.
   * Hub API doesn't support filtering by repository.url, so we fetch all and filter client-side.
   */
  private async fetchAllApplications(): Promise<HubApplication[]> {
    const url = `${this.baseUrl}/hub/applications`;

    this.logger.debug("Fetching all applications from Hub", { url });

    const response = await fetch(url, {
      headers: this.getHeaders("application/x-yaml"),
    });

    const responseText = await response.text();
    const contentType = response.headers.get("content-type") || "";

    // Check if we got HTML instead of YAML - indicates auth failure or wrong endpoint
    if (contentType.includes("text/html") || responseText.trim().startsWith("<!DOCTYPE")) {
      this.logger.error("Hub API returned HTML instead of YAML - likely authentication failure", {
        url,
        status: response.status,
        contentType,
        responsePreview: responseText.substring(0, 200),
      });
      throw new ProfileSyncClientError(
        "Hub API returned HTML instead of YAML. This usually means authentication failed. " +
          "Check that your Hub URL and credentials are correct for this Hub instance.",
      );
    }

    if (!response.ok) {
      this.logger.error("Failed to fetch Hub applications", {
        status: response.status,
        statusText: response.statusText,
        responseBody: responseText.substring(0, 500),
      });
      throw new ProfileSyncClientError(
        `Failed to fetch applications: ${response.status} ${response.statusText}`,
      );
    }

    const applications = this.parseYamlText<HubApplication[]>(responseText);

    this.logger.info("Fetched all applications from Hub", {
      count: applications?.length ?? 0,
      applications: applications?.map((app) => ({
        id: app.id,
        name: app.name,
        repositoryUrl: app.repository?.url,
      })),
    });

    return applications || [];
  }

  /**
   * Find applications matching any of the URL variations
   */
  private findApplicationsByUrlVariations(
    applications: HubApplication[],
    urlVariations: string[],
  ): { matches: HubApplication[]; matchedUrl: string | null } {
    // Create a Set for fast lookup
    const urlSet = new Set(urlVariations.map((url) => url.toLowerCase()));

    const matches: HubApplication[] = [];
    let matchedUrl: string | null = null;

    for (const app of applications) {
      const repoUrl = app.repository?.url;
      if (repoUrl && urlSet.has(repoUrl.toLowerCase())) {
        matches.push(app);
        if (!matchedUrl) {
          matchedUrl = repoUrl;
        }
        this.logger.debug("Found application matching repository URL", {
          appId: app.id,
          appName: app.name,
          repoUrl,
        });
      }
    }

    return { matches, matchedUrl };
  }

  /**
   * Filter applications by branch name.
   * Returns filtered apps if any match the branch, otherwise returns all apps unchanged.
   */
  private filterByBranch(apps: HubApplication[], branch: string): HubApplication[] {
    if (!branch) {
      return apps;
    }

    const branchMatches = apps.filter((app) => app.repository?.branch === branch);

    if (branchMatches.length > 0) {
      this.logger.debug("Filtered applications by branch", {
        branch,
        beforeCount: apps.length,
        afterCount: branchMatches.length,
      });
      return branchMatches;
    }

    this.logger.debug("No branch matches found, keeping all matches", { branch });
    return apps;
  }

  /**
   * Filter applications by workspace relative path.
   * Returns the single matching app, or null if no match or ambiguous.
   * Throws error if match is ambiguous (multiple apps at repo root, etc).
   */
  private filterByPath(apps: HubApplication[], workspacePath: string): HubApplication | null {
    // Single app with no path restriction - always matches
    if (apps.length === 1 && !apps[0].repository?.path) {
      return apps[0];
    }

    // Workspace at repository root
    if (workspacePath === "") {
      // Single app at root (no path) - matches
      if (apps.length === 1 && !apps[0].repository?.path) {
        return apps[0];
      }
      const appsWithPaths = apps.filter((app) => app.repository?.path);

      if (appsWithPaths.length > 0) {
        // Multiple apps with different paths - error
        const pathList = appsWithPaths
          .map((app) => `  - ${app.name} (path: ${app.repository?.path})`)
          .join("\n");

        throw new ProfileSyncClientError(
          `Multiple Hub applications found for this repository, but workspace is at repository root.\n\n` +
            `Found applications:\n${pathList}\n\n` +
            `Please open VS Code with a workspace at one of these subdirectories.`,
        );
      }

      // All apps have no path specified - ambiguous
      const appList = apps.map((app) => `  - ${app.name}`).join("\n");
      throw new ProfileSyncClientError(
        `Multiple Hub applications found with no path specified:\n${appList}\n\n` +
          `This should not happen. Please check your Hub application definitions.`,
      );
    }

    // Workspace at subdirectory - match by path
    const pathMatches = apps.filter((app) => app.repository?.path === workspacePath);

    if (pathMatches.length === 0) {
      this.logger.info("No Hub application matches workspace path", { workspacePath });
      return null;
    }

    if (pathMatches.length === 1) {
      this.logger.info("Found application matching workspace path", {
        applicationId: pathMatches[0].id,
        applicationName: pathMatches[0].name,
        path: workspacePath,
      });
      return pathMatches[0];
    }

    // Multiple matches with same path - shouldn't happen
    const appList = pathMatches.map((app) => `  - ${app.name} (ID: ${app.id})`).join("\n");

    throw new ProfileSyncClientError(
      `Multiple Hub applications found with identical repository configuration:\n${appList}\n\n` +
        `This should not happen. Please check your Hub application definitions.`,
    );
  }

  /**
   * Find Hub application matching the workspace repository.
   *
   * Matches workspace to exactly one Hub application considering:
   * - Repository URL (tries multiple scheme variations)
   * - Current branch
   * - Workspace path relative to repository root
   *
   * Returns null if no matching application found.
   * Throws error if match is ambiguous.
   **/
  private async findApplicationForWorkspace(
    repoInfo: RepositoryInfo,
  ): Promise<HubApplication | null> {
    // Step 1: Generate URL variations we'll match against
    const urlVariations = this.generateUrlVariations(repoInfo.remoteUrl);

    this.logger.info("Searching for Hub application", {
      normalizedUrl: repoInfo.remoteUrl,
      urlVariationsToMatch: urlVariations,
    });

    // Step 2: Fetch all applications from Hub (API doesn't support filtering by repository.url)
    let allApplications: HubApplication[];
    try {
      allApplications = await this.fetchAllApplications();
    } catch (error) {
      this.logger.error("Failed to fetch applications from Hub", { error });
      throw error;
    }

    if (allApplications.length === 0) {
      this.logger.info("No applications found in Hub");
      return null;
    }

    // Step 3: Filter applications locally by matching repository URL
    const { matches, matchedUrl } = this.findApplicationsByUrlVariations(
      allApplications,
      urlVariations,
    );

    if (matches.length === 0) {
      this.logger.info("No Hub applications match repository URL", {
        normalizedUrl: repoInfo.remoteUrl,
        urlVariationsTried: urlVariations.length,
        allApplicationsInHub: allApplications.map((app) => ({
          name: app.name,
          repositoryUrl: app.repository?.url,
        })),
      });
      return null;
    }

    this.logger.info("Found matching applications", {
      matchedUrl,
      matchCount: matches.length,
      matchedApps: matches.map((app) => app.name),
    });

    // Step 4: Filter by branch if multiple matches
    const filteredMatches = this.filterByBranch(matches, repoInfo.currentBranch);

    // Step 5: Filter by path and return result
    const result = this.filterByPath(filteredMatches, repoInfo.workspaceRelativePath);

    if (result) {
      this.logger.info("Found unique application match", {
        applicationId: result.id,
        applicationName: result.name,
      });
    }

    return result;
  }

  /**
   * List analysis profiles for an application
   */
  private async listProfilesForApplication(applicationId: number): Promise<HubProfile[]> {
    const url = `${this.baseUrl}/hub/applications/${applicationId}/analysis/profiles`;

    this.logger.info("Listing profiles for application", { applicationId, url });

    const response = await fetch(url, {
      headers: this.getHeaders("application/x-yaml"),
    });

    const responseText = await response.text();

    this.logger.debug("Profiles API response", {
      applicationId,
      status: response.status,
      statusText: response.statusText,
      responseBody: responseText.substring(0, 500),
    });

    if (!response.ok) {
      // 404 might mean no profiles exist OR the API doesn't exist
      if (response.status === 404) {
        this.logger.warn(
          "Profiles API returned 404 - this could mean no profiles exist or the API is not available",
          {
            applicationId,
            url,
            responseBody: responseText,
          },
        );
        // Return empty array instead of throwing - no profiles is not an error
        return [];
      }

      throw new ProfileSyncClientError(
        `Failed to list profiles: ${response.status} ${response.statusText}`,
      );
    }

    const profiles = this.parseYamlText<HubProfile[]>(responseText);
    this.logger.info("Profiles found for application", {
      applicationId,
      profileCount: profiles?.length ?? 0,
      profiles: profiles?.map((p) => ({ id: p.id, name: p.name })),
    });

    return profiles || [];
  }

  /**
   * Download and extract a profile bundle
   */
  private async downloadAndExtractProfile(
    profileId: number,
    applicationId: number,
    syncDir: string,
  ): Promise<void> {
    const url = `${this.baseUrl}/hub/analysis/profiles/${profileId}/bundle`;

    this.logger.debug("Downloading profile bundle", { profileId, url });

    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new ProfileSyncClientError(
        `Failed to download profile bundle: ${response.status} ${response.statusText}`,
      );
    }

    const tarBuffer = Buffer.from(await response.arrayBuffer());

    // Create profile directory: syncDir/<profileId>/
    const profileDir = path.join(syncDir, profileId.toString());
    await fs.mkdir(profileDir, { recursive: true });

    // Write tar buffer to temporary file
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "konveyor-profile-"));
    const tempTarFile = path.join(tempDir, "profile.tar");
    try {
      await fs.writeFile(tempTarFile, tarBuffer);

      // Extract tar bundle to profile directory
      await tar.extract({
        file: tempTarFile,
        cwd: profileDir,
        strip: 0, // Keep full paths from tar
        filter: (path) => {
          const normalized = path.replace(/\\/g, "/");
          if (
            normalized.startsWith("/") ||
            normalized.includes("../") ||
            normalized.startsWith("..")
          ) {
            return false;
          }
          return true;
        },
      });
    } finally {
      // Clean up temp file
      await fs.rm(tempDir, { recursive: true, force: true });
    }

    // Transform Hub format to standard metadata/spec format if needed
    const profileYamlPath = path.join(profileDir, "profile.yaml");
    try {
      // Ensure profile.yaml is writable before transformation (tar may extract with read-only permissions)
      try {
        const stats = await fs.stat(profileYamlPath);
        await fs.chmod(profileYamlPath, stats.mode | 0o200); // Add write permission for owner
      } catch (chmodError) {
        this.logger.debug("Could not set write permissions on profile.yaml", {
          profileId,
          chmodError,
        });
      }

      const profileContent = await fs.readFile(profileYamlPath, "utf-8");
      const parsed = yaml.load(profileContent, { schema: yaml.JSON_SCHEMA }) as Record<string, any>;

      // Check if it's Hub format (flat structure) and needs transformation
      if (parsed && typeof parsed === "object" && parsed.id && parsed.name && !parsed.metadata) {
        this.logger.debug("Transforming Hub profile format to standard format", { profileId });

        // Save original Hub format for debugging
        const hubProfilePath = path.join(profileDir, "profile.hub.yaml");
        await fs.writeFile(hubProfilePath, profileContent, "utf-8");
        this.logger.debug("Saved original Hub profile format", { profileId, path: hubProfilePath });

        // Build labelSelector from rules.labels if present
        // Uses the same logic as Go RuleSelector.String()
        let labelSelector = "";
        if (parsed.rules?.labels) {
          const included = parsed.rules.labels.included || [];
          const excluded = parsed.rules.labels.excluded || [];

          labelSelector = buildLabelSelectorFromLabels(included, excluded);
        }

        // Find all ruleset YAML files in the extracted bundle
        // Look for .yaml files in rules/ subdirectories, excluding test files and profile.yaml
        const customRules: string[] = [];
        try {
          const rulesetFiles = await glob.glob(path.join(profileDir, "rules/**/*.yaml"), {
            ignore: ["**/*.test.yaml", "**/profile.yaml"],
          });

          // Convert to relative paths from profile directory
          for (const rulesetFile of rulesetFiles) {
            const relativePath = path.relative(profileDir, rulesetFile);
            // Use forward slashes for cross-platform compatibility
            customRules.push(relativePath.split(path.sep).join("/"));
          }

          this.logger.debug("Found ruleset files in bundle", {
            profileId,
            count: customRules.length,
            files: customRules,
          });
        } catch (globError) {
          this.logger.warn("Failed to find ruleset files in bundle", { profileId, globError });
        }

        // Determine useDefaultRules based on Hub profile mode
        // If mode.withDeps is true, we likely want default rules too
        const useDefaultRules = parsed.mode?.withDeps ?? false;

        // Transform to standard format matching the spec
        const standardProfile = {
          metadata: {
            id: String(parsed.id),
            name: parsed.name,
            readonly: true, // Hub profiles are read-only
            source: "hub",
            version: parsed.version,
            syncedAt: new Date().toISOString(),
          },
          spec: {
            labelSelector,
            customRules,
            useDefaultRules,
          },
        };

        // Write transformed profile back
        await fs.writeFile(profileYamlPath, yaml.dump(standardProfile), "utf-8");
        this.logger.debug("Profile transformed to standard format", {
          profileId,
          labelSelector,
          customRulesCount: customRules.length,
          useDefaultRules,
        });
      }
    } catch (error) {
      this.logger.warn("Failed to transform profile format, using as-is", { profileId, error });
      // Continue - profile might already be in correct format
    }

    // Create metadata file
    const metadata: HubProfileMetadata = {
      hubProfileId: profileId,
      applicationId: applicationId,
      syncedAt: new Date().toISOString(),
      isHubManaged: true,
    };

    await fs.writeFile(
      path.join(profileDir, ".hub-metadata.json"),
      JSON.stringify(metadata, null, 2),
      "utf-8",
    );

    this.logger.info("Profile bundle extracted", { profileId, profileDir });
  }

  /**
   * Parse YAML response from Hub API
   */
  private async parseYamlResponse<T>(response: Response): Promise<T> {
    const text = await response.text();
    return this.parseYamlText<T>(text);
  }

  /**
   * Parse YAML text directly
   */
  private parseYamlText<T>(text: string): T {
    if (!text || text.trim() === "") {
      // Empty response - return empty array for list endpoints
      return [] as T;
    }

    try {
      const parsed = yaml.load(text, { schema: yaml.JSON_SCHEMA }) as Record<string, any>;
      return parsed as T;
    } catch (error) {
      this.logger.error("Failed to parse YAML response", { text, error });
      throw new ProfileSyncClientError(
        `Failed to parse YAML response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get HTTP headers for Hub API requests
   */
  private getHeaders(accept: string = "application/json"): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept,
    };

    if (this.bearerToken) {
      headers["Authorization"] = `Bearer ${this.bearerToken}`;
    }

    return headers;
  }
}
