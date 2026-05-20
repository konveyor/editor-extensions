import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { ProfileEditorForm } from "../ProfileEditorForm";
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

describe("ProfileEditorForm", () => {
  beforeEach(() => {
    (globalThis as any).__dispatchedMessages = [];
    useExtensionStore.setState({
      isWebEnvironment: false,
      availableTargets: ["quarkus", "spring-boot", "eap8"],
      availableSources: ["java-ee", "weblogic", "spring-boot"],
    } as any);
  });

  const defaultProps = {
    profile: mockProfile(),
    isActive: false,
    onChange: (() => {}) as (p: AnalysisProfile) => void,
    onDelete: (() => {}) as (id: string) => void,
    onMakeActive: (() => {}) as (id: string) => void,
    allProfiles: [mockProfile()],
    isDisabled: false,
  };

  describe("Rendering", () => {
    it("renders profile name input with current value", () => {
      render(<ProfileEditorForm {...defaultProps} />);
      expect(screen.getByDisplayValue("Test Profile")).toBeTruthy();
    });

    it("shows character count for profile name", () => {
      render(<ProfileEditorForm {...defaultProps} />);
      expect(screen.getByText(/12\/24 characters/)).toBeTruthy();
    });

    it("renders Use Default Rules switch", () => {
      render(<ProfileEditorForm {...defaultProps} />);
      expect(screen.getByText("Use Default Rules")).toBeTruthy();
    });

    it("renders Target Technologies section", () => {
      render(<ProfileEditorForm {...defaultProps} />);
      expect(screen.getByText("Target Technologies")).toBeTruthy();
    });

    it("renders Source Technologies section", () => {
      render(<ProfileEditorForm {...defaultProps} />);
      expect(screen.getByText("Source Technologies")).toBeTruthy();
    });

    it("renders Custom Rules section", () => {
      render(<ProfileEditorForm {...defaultProps} />);
      expect(screen.getByText("Custom Rules")).toBeTruthy();
    });

    it("renders Select Custom Rules button in desktop mode", () => {
      render(<ProfileEditorForm {...defaultProps} />);
      expect(screen.getByText("Select Custom Rules…")).toBeTruthy();
    });

    it("renders Upload button in web environment", () => {
      useExtensionStore.setState({ isWebEnvironment: true } as any);
      render(<ProfileEditorForm {...defaultProps} />);
      expect(screen.getByText("Upload Custom Rules…")).toBeTruthy();
    });

    it("shows Make Active button when profile is not active", () => {
      render(<ProfileEditorForm {...defaultProps} isActive={false} />);
      expect(screen.getByText("Make Active")).toBeTruthy();
    });

    it("hides Make Active button when profile is already active", () => {
      render(<ProfileEditorForm {...defaultProps} isActive={true} />);
      expect(screen.queryByText("Make Active")).toBeNull();
    });

    it("shows Delete button", () => {
      render(<ProfileEditorForm {...defaultProps} />);
      expect(screen.getByText("Delete")).toBeTruthy();
    });
  });

  describe("Validation", () => {
    it("shows error when profile name is empty on blur", () => {
      render(<ProfileEditorForm {...defaultProps} />);
      const input = screen.getByDisplayValue("Test Profile");
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.blur(input);
      expect(screen.getByText("Profile name is required.")).toBeTruthy();
    });

    it("shows error for duplicate profile name on blur", () => {
      const profiles = [
        mockProfile({ id: "p1", name: "First" }),
        mockProfile({ id: "p2", name: "Second" }),
      ];
      render(
        <ProfileEditorForm
          {...defaultProps}
          profile={profiles[0]}
          allProfiles={profiles}
        />,
      );
      const input = screen.getByDisplayValue("First");
      fireEvent.change(input, { target: { value: "Second" } });
      fireEvent.blur(input);
      expect(screen.getByText("A profile with this name already exists.")).toBeTruthy();
    });

    it("enforces max name length of 24 characters", () => {
      render(<ProfileEditorForm {...defaultProps} />);
      const input = screen.getByDisplayValue("Test Profile") as HTMLInputElement;
      const longName = "A".repeat(30);
      fireEvent.change(input, { target: { value: longName } });
      expect(input.value.length).toBeLessThanOrEqual(24);
    });

    it("shows rules validation error when both default and custom rules are disabled", () => {
      const noRulesProfile = mockProfile({
        useDefaultRules: false,
        customRules: [],
      });
      render(
        <ProfileEditorForm {...defaultProps} profile={noRulesProfile} />,
      );
      expect(
        screen.getByText("Enable default rules or add custom rules."),
      ).toBeTruthy();
    });
  });

  describe("Interactions", () => {
    it("calls onMakeActive when Make Active button is clicked", () => {
      const calls: string[] = [];
      render(
        <ProfileEditorForm
          {...defaultProps}
          onMakeActive={(id) => calls.push(id)}
        />,
      );
      fireEvent.click(screen.getByText("Make Active"));
      expect(calls).toContain("profile-1");
    });

    it("shows delete confirmation dialog when Delete is clicked", () => {
      render(<ProfileEditorForm {...defaultProps} />);
      fireEvent.click(screen.getByText("Delete"));
      expect(screen.getByText(/Are you sure you want to delete/)).toBeTruthy();
    });

    it("dispatches CONFIGURE_CUSTOM_RULES when Select Custom Rules is clicked", () => {
      render(<ProfileEditorForm {...defaultProps} />);
      fireEvent.click(screen.getByText("Select Custom Rules…"));
      const msgs = getDispatched();
      const msg = msgs.find((m) => m.type === "CONFIGURE_CUSTOM_RULES");
      expect(msg).toBeTruthy();
      expect(msg.payload.profileId).toBe("profile-1");
    });

    it("renders custom rules as labels with filenames", () => {
      const profile = mockProfile({
        customRules: ["/path/to/rule1.yaml", "/path/to/rule2.yaml"],
      });
      render(<ProfileEditorForm {...defaultProps} profile={profile} />);
      expect(screen.getByText("rule1.yaml")).toBeTruthy();
      expect(screen.getByText("rule2.yaml")).toBeTruthy();
    });
  });

  describe("Read-only mode", () => {
    it("disables name input for read-only profiles", () => {
      const roProfile = mockProfile({ readOnly: true });
      render(<ProfileEditorForm {...defaultProps} profile={roProfile} />);
      const input = screen.getByDisplayValue("Test Profile") as HTMLInputElement;
      expect(input.disabled).toBe(true);
    });

    it("disables Delete button for read-only profiles", () => {
      const roProfile = mockProfile({ readOnly: true });
      render(<ProfileEditorForm {...defaultProps} profile={roProfile} />);
      const deleteBtn = screen.getByText("Delete").closest("button") as HTMLButtonElement;
      expect(deleteBtn.disabled).toBe(true);
    });

    it("disables Select Custom Rules for read-only profiles", () => {
      const roProfile = mockProfile({ readOnly: true });
      render(<ProfileEditorForm {...defaultProps} profile={roProfile} />);
      const btn = screen.getByText("Select Custom Rules…").closest("button") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  describe("Disabled during analysis", () => {
    it("shows warning when isDisabled is true", () => {
      render(<ProfileEditorForm {...defaultProps} isDisabled={true} />);
      expect(screen.getByText("Editing disabled during analysis")).toBeTruthy();
    });

    it("disables Make Active button when isDisabled", () => {
      render(<ProfileEditorForm {...defaultProps} isDisabled={true} />);
      const btn = screen.getByText("Make Active").closest("button") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  describe("Label selector parsing", () => {
    it("parses existing label selector without crashing", () => {
      const profile = mockProfile({
        labelSelector:
          "konveyor.io/target=quarkus || konveyor.io/source=java-ee",
      });
      render(<ProfileEditorForm {...defaultProps} profile={profile} />);
      expect(screen.getByText("Target Technologies")).toBeTruthy();
    });
  });
});
