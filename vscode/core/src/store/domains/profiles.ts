/**
 * Profiles Domain Actions
 *
 * All profile management operations: CRUD, activation, source mode management
 */

import type { AnalysisProfile } from "@editor-extensions/shared";
import type { StateCreator } from "zustand";
import type { ExtensionStore } from "../extensionStore";

/**
 * Profiles domain action types
 */
export interface ProfilesDomainActions {
  /**
   * Profiles domain
   * All profile management operations
   */
  profiles: {
    /**
     * Load profiles from source (filesystem, storage, or Hub)
     */
    load: (profiles: AnalysisProfile[], activeId: string | null) => void;

    /**
     * Add a new user-created profile
     */
    add: (profile: AnalysisProfile) => void;

    /**
     * Update an existing profile
     */
    update: (profileId: string, updates: Partial<AnalysisProfile>) => void;

    /**
     * Remove a profile
     */
    remove: (profileId: string) => void;

    /**
     * Activate a profile (make it the active one)
     */
    activate: (profileId: string) => void;

    /**
     * Mode management - profiles from .konveyor/profiles or Hub
     */
    mode: {
      /**
       * Enter tree mode (profiles from .konveyor/profiles or Hub)
       */
      enterTreeMode: () => void;

      /**
       * Exit tree mode (profiles from user storage)
       */
      exitTreeMode: () => void;
    };
  };
}

/**
 * Create Profiles domain actions
 * This slice focuses on profile management business logic
 */
export const createProfilesActions: StateCreator<
  ExtensionStore,
  [["zustand/subscribeWithSelector", never], ["zustand/immer", never]],
  [],
  ProfilesDomainActions
> = (set) => ({
  profiles: {
    load: (profiles, activeId) =>
      set((state) => {
        state.profilesList = profiles;
        state.activeProfileId = activeId;

        // Business rule: Determine if we're in tree mode based on profile sources
        state.isInTreeMode = profiles.some((p) => p.source === "hub" || p.source === "local");
      }),

    add: (profile) =>
      set((state) => {
        state.profilesList.push(profile);
      }),

    update: (profileId, updates) =>
      set((state) => {
        const index = state.profilesList.findIndex((p) => p.id === profileId);
        if (index !== -1) {
          state.profilesList[index] = { ...state.profilesList[index], ...updates };
        }
      }),

    remove: (profileId) =>
      set((state) => {
        state.profilesList = state.profilesList.filter((p) => p.id !== profileId);

        // Business rule: If we removed the active profile, clear active ID
        if (state.activeProfileId === profileId) {
          state.activeProfileId = state.profilesList[0]?.id ?? null;
        }
      }),

    activate: (profileId) =>
      set((state) => {
        // Business rule: Only activate if profile exists
        const exists = state.profilesList.some((p) => p.id === profileId);
        if (exists) {
          state.activeProfileId = profileId;
        }
      }),

    mode: {
      enterTreeMode: () =>
        set((state) => {
          state.isInTreeMode = true;
        }),

      exitTreeMode: () =>
        set((state) => {
          state.isInTreeMode = false;
        }),
    },
  },
});
