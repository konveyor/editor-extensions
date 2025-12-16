/**
 * Initialize Sync Bridges
 *
 * This module sets up declarative sync bridges between the vanilla Zustand store
 * and webviews. Each bridge automatically broadcasts state changes to all connected webviews.
 */

import { extensionStore } from "./extensionStore";
import { SyncBridgeManager } from "./syncBridge";
import type { KonveyorGUIWebviewViewProvider } from "../KonveyorGUIWebviewViewProvider";
import type winston from "winston";

/**
 * Initialize all sync bridges for the extension
 *
 * This sets up declarative subscriptions that automatically sync state
 * from the extension host to webviews.
 */
export function initializeSyncBridges(
  webviewProviders: Map<string, KonveyorGUIWebviewViewProvider>,
  logger?: winston.Logger,
): SyncBridgeManager {
  const manager = new SyncBridgeManager(extensionStore, webviewProviders, logger);

  // Phase 2: Cheap boolean flags
  // Issue 4: Loading flags
  manager.createBridge({
    selector: (state) => ({
      isFetchingSolution: state.isFetchingSolution,
    }),
    messageType: "SOLUTION_LOADING_UPDATE",
    debugName: "isFetchingSolution",
  });

  // Issue 5: Analysis flags (can be enabled in parallel)
  manager.createBridge({
    selector: (state) => ({
      isAnalyzing: state.isAnalyzing,
      isAnalysisScheduled: state.isAnalysisScheduled,
    }),
    messageType: "ANALYSIS_FLAGS_UPDATE",
    debugName: "analysisFlags",
  });

  // Issue 6: Server state (can be enabled in parallel)
  manager.createBridge({
    selector: (state) => ({
      serverState: state.serverState,
      isStartingServer: state.isStartingServer,
      isInitializingServer: state.isInitializingServer,
      solutionServerConnected: state.solutionServerConnected,
      profileSyncConnected: state.profileSyncConnected,
      llmProxyAvailable: state.llmProxyAvailable,
    }),
    messageType: "SERVER_STATE_UPDATE",
    debugName: "serverState",
  });

  // Phase 3: Expensive updates with equality checking
  // Issue 7: RuleSets (uncomment when ready to migrate)
  // manager.createBridge({
  //   selector: (state) => ({
  //     ruleSets: state.ruleSets,
  //   }),
  //   messageType: "RULESETS_UPDATE",
  //   equalityFn: equalityFns.shallow,
  //   debugName: "ruleSets",
  // });

  // Issue 8: Enhanced incidents (uncomment when ready to migrate)
  // manager.createBridge({
  //   selector: (state) => ({
  //     enhancedIncidents: state.enhancedIncidents,
  //   }),
  //   messageType: "INCIDENTS_UPDATE",
  //   equalityFn: equalityFns.shallow,
  //   debugName: "enhancedIncidents",
  // });

  // Issue 9: Profiles (uncomment when ready to migrate)
  // manager.createBridge({
  //   selector: (state) => ({
  //     profiles: state.profiles,
  //     activeProfileId: state.activeProfileId,
  //     isInTreeMode: state.isInTreeMode,
  //   }),
  //   messageType: "PROFILES_UPDATE",
  //   equalityFn: equalityFns.shallow,
  //   debugName: "profiles",
  // });

  // Issue 11: Config errors (uncomment when ready to migrate)
  // manager.createBridge({
  //   selector: (state) => ({
  //     configErrors: state.configErrors,
  //   }),
  //   messageType: "CONFIG_ERRORS_UPDATE",
  //   debugName: "configErrors",
  // });

  // Issue 12: Active decorators (uncomment when ready to migrate)
  // manager.createBridge({
  //   selector: (state) => ({
  //     activeDecorators: state.activeDecorators,
  //   }),
  //   messageType: "DECORATORS_UPDATE",
  //   debugName: "activeDecorators",
  // });

  // Settings bridge
  manager.createBridge({
    selector: (state) => ({
      solutionServerEnabled: state.solutionServerEnabled,
      isAgentMode: state.isAgentMode,
      isContinueInstalled: state.isContinueInstalled,
      hubConfig: state.hubConfig,
      profileSyncEnabled: state.profileSyncEnabled,
      isSyncingProfiles: state.isSyncingProfiles,
      llmProxyAvailable: state.llmProxyAvailable,
    }),
    messageType: "SETTINGS_UPDATE",
    debugName: "settings",
  });

  if (logger) {
    logger.info(`[SyncBridge] Initialized ${manager.getDebugInfo().totalBridges} sync bridges`);
  }

  return manager;
}
