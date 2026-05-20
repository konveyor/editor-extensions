import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ProfileManagerPage } from "../ProfileManagerPage";
import { useExtensionStore } from "../../../store/store";
import { AnalysisProfile } from "@editor-extensions/shared";

function getDispatched(): any[] {
  return (globalThis as any).__dispatchedMessages || [];
}

const mockProfile = (overrides: Partial<AnalysisProfile> = {}): AnalysisProfile => ({
  id: "profile-1",
  name: "Test Profile",
  customRules: [],
  useDefaultRules: true,
  labelSelector: "",
  ...overrides,
});

function setStoreState(state: Partial<ReturnType<typeof useExtensionStore.getState>>) {
  useExtensionStore.setState(state as any);
}

describe("ProfileManagerPage", () => {
  beforeEach(() => {
    (globalThis as any).__dispatchedMessages = [];
    setStoreState({
      profiles: [],
      activeProfileId: null,
      isAnalyzing: false,
    });
  });

  describe("Empty state", () => {
    it("renders empty state when no profiles exist", () => {
      render(<ProfileManagerPage />);
      expect(screen.getByText("No profiles yet")).toBeTruthy();
    });

    it("shows description text in empty state", () => {
      render(<ProfileManagerPage />);
      expect(
        screen.getByText(/Profiles let you configure analysis rules/),
      ).toBeTruthy();
    });

    it("renders New Profile button in empty state", () => {
      render(<ProfileManagerPage />);
      const button = screen.getByRole("button", { name: /New Profile/i });
      expect(button).toBeTruthy();
    });

    it("renders Import button in empty state", () => {
      render(<ProfileManagerPage />);
      const button = screen.getByRole("button", { name: /Import/i });
      expect(button).toBeTruthy();
    });

    it("dispatches ADD_PROFILE when New Profile is clicked", () => {
      render(<ProfileManagerPage />);
      const button = screen.getByRole("button", { name: /New Profile/i });
      fireEvent.click(button);
      const msgs = getDispatched();
      const addMsg = msgs.find((m) => m.type === "ADD_PROFILE");
      expect(addMsg).toBeTruthy();
      expect(addMsg.payload.name).toBe("New Profile");
    });

    it("dispatches OPEN_HUB_SETTINGS when Import is clicked", () => {
      render(<ProfileManagerPage />);
      const button = screen.getByRole("button", { name: /Import/i });
      fireEvent.click(button);
      const msgs = getDispatched();
      const msg = msgs.find((m) => m.type === "OPEN_HUB_SETTINGS");
      expect(msg).toBeTruthy();
    });
  });

  describe("With profiles", () => {
    const profiles = [
      mockProfile({ id: "p1", name: "Profile One" }),
      mockProfile({ id: "p2", name: "Profile Two" }),
    ];

    beforeEach(() => {
      setStoreState({
        profiles,
        activeProfileId: "p1",
        isAnalyzing: false,
      });
    });

    it("renders the profile list sidebar", () => {
      render(<ProfileManagerPage />);
      expect(screen.getAllByText("Profile One").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Profile Two").length).toBeGreaterThan(0);
    });

    it("shows active badge for the active profile in masthead", () => {
      render(<ProfileManagerPage />);
      expect(screen.getByText("active")).toBeTruthy();
    });

    it("does not show empty state when profiles exist", () => {
      render(<ProfileManagerPage />);
      expect(screen.queryByText("No profiles yet")).toBeNull();
    });

    it("generates unique name when duplicate would exist", () => {
      setStoreState({
        profiles: [mockProfile({ id: "p1", name: "New Profile" })],
        activeProfileId: "p1",
        isAnalyzing: false,
      });
      render(<ProfileManagerPage />);

      const createBtn = screen.getByRole("button", { name: /Create new profile/i });
      fireEvent.click(createBtn);

      const msgs = getDispatched();
      const addMsg = msgs.find((m) => m.type === "ADD_PROFILE");
      expect(addMsg).toBeTruthy();
      expect(addMsg.payload.name).toBe("New Profile 1");
    });

    it("disables New Profile button when isAnalyzing is true", () => {
      setStoreState({
        profiles,
        activeProfileId: "p1",
        isAnalyzing: true,
      });
      render(<ProfileManagerPage />);
      const createBtn = screen.getByRole("button", { name: /Create new profile/i });
      expect(createBtn).toHaveProperty("disabled", true);
    });
  });

  describe("Masthead", () => {
    it("shows Auto-saved indicator when a profile is selected", () => {
      setStoreState({
        profiles: [mockProfile({ id: "p1", name: "Active" })],
        activeProfileId: "p1",
        isAnalyzing: false,
      });
      render(<ProfileManagerPage />);
      expect(screen.getByText("Auto-saved")).toBeTruthy();
    });

    it("shows read-only label for read-only profiles", () => {
      setStoreState({
        profiles: [mockProfile({ id: "p1", name: "Locked", readOnly: true })],
        activeProfileId: "p1",
        isAnalyzing: false,
      });
      render(<ProfileManagerPage />);
      expect(screen.getByText("read-only")).toBeTruthy();
    });
  });
});
