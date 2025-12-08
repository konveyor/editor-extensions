import expect from "expect";
import type { HubApplication } from "../ProfileSyncClient";
import { ProfileSyncClient } from "../ProfileSyncClient";
import winston from "winston";

/**
 * Tests for Hub application matching scenarios.
 * These tests validate the logic in filterByBranch() and filterByPath() helper methods.
 */
describe("ProfileSyncClient - Application Matching", () => {
  let client: ProfileSyncClient;
  let logger: winston.Logger;

  beforeEach(() => {
    logger = winston.createLogger({ silent: true });
    client = new ProfileSyncClient("https://hub.example.com", "test-token", logger);
  });

  describe("filterByBranch", () => {
    it("should return all apps when no branch specified", () => {
      const apps: HubApplication[] = [
        {
          id: 1,
          name: "App 1",
          repository: { url: "github.com/org/repo", branch: "main" },
        },
        {
          id: 2,
          name: "App 2",
          repository: { url: "github.com/org/repo", branch: "develop" },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      const result = client.filterByBranch(apps, "");

      expect(result).toEqual(apps);
      expect(result.length).toBe(2);
    });

    it("should filter apps by branch when matches exist", () => {
      const apps: HubApplication[] = [
        {
          id: 1,
          name: "App 1",
          repository: { url: "github.com/org/repo", branch: "main" },
        },
        {
          id: 2,
          name: "App 2",
          repository: { url: "github.com/org/repo", branch: "develop" },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      const result = client.filterByBranch(apps, "main");

      expect(result.length).toBe(1);
      expect(result[0].id).toBe(1);
      expect(result[0].repository?.branch).toBe("main");
    });

    it("should return all apps when no branch matches found", () => {
      const apps: HubApplication[] = [
        {
          id: 1,
          name: "App 1",
          repository: { url: "github.com/org/repo", branch: "main" },
        },
        {
          id: 2,
          name: "App 2",
          repository: { url: "github.com/org/repo", branch: "develop" },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      const result = client.filterByBranch(apps, "feature");

      expect(result).toEqual(apps);
      expect(result.length).toBe(2);
    });
  });

  describe("filterByPath - Test Scenarios", () => {
    /**
     * Scenario 1: Single application, workspace at root
     * Hub: App 1 (url=github.com/org/repo, branch=main, path="")
     * Workspace: /repo (branch=main)
     * Result: ✅ Match App 1
     */
    it("Scenario 1: should return single app when only one exists", () => {
      const apps: HubApplication[] = [
        {
          id: 1,
          name: "App 1",
          repository: { url: "github.com/org/repo", branch: "main", path: "" },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      const result = client.filterByPath(apps, "");

      expect(result).toBeTruthy();
      expect(result?.id).toBe(1);
    });

    /**
     * Scenario 2: Multiple applications with paths, workspace at root
     * Hub: App 1 (url=github.com/org/repo, branch=main, path=/app1)
     * Hub: App 2 (url=github.com/org/repo, branch=main, path=/app2)
     * Workspace: /repo (branch=main)
     * Result: ❌ Error - ask user to open /repo/app1 or /repo/app2
     */
    it("Scenario 2: should throw error when multiple apps with paths exist and workspace at root", () => {
      const apps: HubApplication[] = [
        {
          id: 1,
          name: "App 1",
          repository: { url: "github.com/org/repo", branch: "main", path: "/app1" },
        },
        {
          id: 2,
          name: "App 2",
          repository: { url: "github.com/org/repo", branch: "main", path: "/app2" },
        },
      ];

      expect(() => {
        // @ts-expect-error - accessing private method for testing
        client.filterByPath(apps, "");
      }).toThrow(/Multiple Hub applications found for this repository/);
    });

    /**
     * Scenario 3: Multiple applications with paths, workspace at subdirectory
     * Hub: App 1 (url=github.com/org/repo, branch=main, path=/app1)
     * Hub: App 2 (url=github.com/org/repo, branch=main, path=/app2)
     * Workspace: /repo/app1 (branch=main)
     * Result: ✅ Match App 1
     */
    it("Scenario 3: should match app by workspace path when at subdirectory", () => {
      const apps: HubApplication[] = [
        {
          id: 1,
          name: "App 1",
          repository: { url: "github.com/org/repo", branch: "main", path: "/app1" },
        },
        {
          id: 2,
          name: "App 2",
          repository: { url: "github.com/org/repo", branch: "main", path: "/app2" },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      const result = client.filterByPath(apps, "/app1");

      expect(result).toBeTruthy();
      expect(result?.id).toBe(1);
      expect(result?.name).toBe("App 1");
    });

    /**
     * Scenario 4: Different branches (handled by filterByBranch, but testing path logic)
     * Hub: App 1 (url=github.com/org/repo, branch=main, path="")
     * Hub: App 2 (url=github.com/org/repo, branch=develop, path="")
     * Workspace: /repo (branch=main)
     * Result: ✅ After branch filter, single app remains
     */
    it("Scenario 4: should return app when single app after branch filtering", () => {
      const apps: HubApplication[] = [
        {
          id: 1,
          name: "App 1",
          repository: { url: "github.com/org/repo", branch: "main", path: "" },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      const result = client.filterByPath(apps, "");

      expect(result).toBeTruthy();
      expect(result?.id).toBe(1);
    });

    /**
     * Scenario 5: No matching application (tested at higher level)
     * Hub: App 1 (url=github.com/other/repo, branch=main, path="")
     * Workspace: /repo (url=github.com/org/repo, branch=main)
     * Result: ✅ Return null (no match)
     * Note: This is tested by the URL variation logic, not filterByPath
     */

    /**
     * Scenario 6: Workspace subdirectory doesn't match any Hub app path
     * Hub: App 1 (url=github.com/org/repo, branch=main, path=/app1)
     * Workspace: /repo/app2 (branch=main)
     * Result: ✅ Return null (no match)
     */
    it("Scenario 6: should return null when workspace path doesn't match any app", () => {
      const apps: HubApplication[] = [
        {
          id: 1,
          name: "App 1",
          repository: { url: "github.com/org/repo", branch: "main", path: "/app1" },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      const result = client.filterByPath(apps, "/app2");

      expect(result).toBeNull();
    });

    it("should throw error when multiple apps have no path specified", () => {
      const apps: HubApplication[] = [
        {
          id: 1,
          name: "App 1",
          repository: { url: "github.com/org/repo", branch: "main" },
        },
        {
          id: 2,
          name: "App 2",
          repository: { url: "github.com/org/repo", branch: "main" },
        },
      ];

      expect(() => {
        // @ts-expect-error - accessing private method for testing
        client.filterByPath(apps, "");
      }).toThrow(/Multiple Hub applications found with no path specified/);
    });

    it("should throw error when multiple apps have same path", () => {
      const apps: HubApplication[] = [
        {
          id: 1,
          name: "App 1",
          repository: { url: "github.com/org/repo", branch: "main", path: "/app1" },
        },
        {
          id: 2,
          name: "App 2",
          repository: { url: "github.com/org/repo", branch: "main", path: "/app1" },
        },
      ];

      expect(() => {
        // @ts-expect-error - accessing private method for testing
        client.filterByPath(apps, "/app1");
      }).toThrow(/Multiple Hub applications found with identical repository configuration/);
    });
  });
});
