/**
 * Analysis Domain Actions
 *
 * All code analysis operations: running analysis, progress tracking, results management
 */

import type { RuleSet, EnhancedIncident } from "@editor-extensions/shared";
import type { StateCreator } from "zustand";
import type { ExtensionStore } from "../extensionStore";

/**
 * Analysis domain action types
 */
export interface AnalysisDomainActions {
  /**
   * Analysis domain
   * All code analysis operations
   */
  analysis: {
    /**
     * Begin analysis operation
     */
    begin: () => void;

    /**
     * Update analysis progress
     */
    updateProgress: (progress: number, message?: string) => void;

    /**
     * Complete analysis successfully
     */
    complete: (results: { ruleSets: RuleSet[]; incidents: EnhancedIncident[] }) => void;

    /**
     * Analysis failed
     */
    fail: (error: Error) => void;

    /**
     * Cancel running analysis
     */
    cancel: () => void;

    /**
     * Schedule analysis for later execution
     */
    schedule: () => void;

    /**
     * Cancel scheduled analysis
     */
    cancelScheduled: () => void;

    /**
     * Update success rates for incidents
     */
    updateSuccessRates: (incidents: EnhancedIncident[]) => void;

    /**
     * Clear all analysis results
     */
    clearResults: () => void;
  };
}

/**
 * Create Analysis domain actions
 * This slice focuses on code analysis business logic
 */
export const createAnalysisActions: StateCreator<
  ExtensionStore,
  [["zustand/subscribeWithSelector", never], ["zustand/immer", never]],
  [],
  AnalysisDomainActions
> = (set) => ({
  analysis: {
    begin: () =>
      set((state) => {
        state.isAnalyzing = true;
        state.analysisProgress = 0;
        state.analysisProgressMessage = "Starting analysis...";
      }),

    updateProgress: (progress, message) =>
      set((state) => {
        state.analysisProgress = progress;
        if (message !== undefined) {
          state.analysisProgressMessage = message;
        }
      }),

    complete: (results) =>
      set((state) => {
        state.isAnalyzing = false;
        state.analysisProgress = 100;
        state.analysisProgressMessage = "Analysis complete";
        state.ruleSets = results.ruleSets;
        state.enhancedIncidents = results.incidents;
      }),

    fail: (error) =>
      set((state) => {
        state.isAnalyzing = false;
        state.analysisProgress = undefined;
        state.analysisProgressMessage = `Analysis failed: ${error.message}`;
      }),

    cancel: () =>
      set((state) => {
        state.isAnalyzing = false;
        state.analysisProgress = undefined;
        state.analysisProgressMessage = "Analysis cancelled";
      }),

    schedule: () =>
      set((state) => {
        state.isAnalysisScheduled = true;
      }),

    cancelScheduled: () =>
      set((state) => {
        state.isAnalysisScheduled = false;
      }),

    updateSuccessRates: (incidents) =>
      set((state) => {
        state.enhancedIncidents = incidents;
      }),

    clearResults: () =>
      set((state) => {
        state.ruleSets = [];
        state.enhancedIncidents = [];
      }),
  },
});
