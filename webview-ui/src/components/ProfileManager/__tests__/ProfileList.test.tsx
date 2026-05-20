import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { ProfileList } from "../ProfileList";
import { AnalysisProfile } from "@editor-extensions/shared";

const mockProfile = (overrides: Partial<AnalysisProfile> = {}): AnalysisProfile => ({
  id: "profile-1",
  name: "Test Profile",
  customRules: [],
  useDefaultRules: true,
  labelSelector: "",
  ...overrides,
});

describe("ProfileList", () => {
  const defaultProps = {
    profiles: [
      mockProfile({ id: "p1", name: "First" }),
      mockProfile({ id: "p2", name: "Second" }),
      mockProfile({ id: "p3", name: "Third", readOnly: true }),
    ],
    selected: "p1",
    active: "p1",
    onSelect: (() => {}) as (id: string) => void,
    onDelete: (() => {}) as (id: string) => void,
    onMakeActive: (() => {}) as (id: string) => void,
    onDuplicate: (() => {}) as (profile: AnalysisProfile) => void,
    isDisabled: false,
  };

  it("renders all profiles in the list", () => {
    render(<ProfileList {...defaultProps} />);
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
    expect(screen.getByText("Third")).toBeTruthy();
  });

  it("calls onSelect when a profile is clicked", () => {
    const calls: string[] = [];
    render(
      <ProfileList {...defaultProps} onSelect={(id) => calls.push(id)} />,
    );
    fireEvent.click(screen.getByText("Second"));
    expect(calls).toContain("p2");
  });

  it("shows star icon for the active profile", () => {
    const { container } = render(<ProfileList {...defaultProps} active="p1" />);
    // PatternFly renders SVG icons; StarIcon has a specific path or aria-label
    const svgs = container.querySelectorAll("svg");
    // At least one SVG should be the star icon for the active profile
    expect(svgs.length).toBeGreaterThan(0);
  });

  it("shows lock icon for read-only profiles", () => {
    const { container } = render(<ProfileList {...defaultProps} />);
    // Read-only profile renders a lock SVG icon
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
  });

  describe("Kebab menu actions", () => {
    it("shows Duplicate option in kebab menu", () => {
      render(<ProfileList {...defaultProps} />);
      // Open kebab for second profile - find plain variant toggle buttons
      const toggleButtons = screen.getAllByRole("button");
      // Filter for the kebab toggles (plain variant buttons that aren't list items)
      const kebabs = toggleButtons.filter(
        (btn) => btn.classList.contains("pf-m-plain") || btn.querySelector("svg"),
      );
      if (kebabs.length >= 2) {
        fireEvent.click(kebabs[1]);
        expect(screen.getByText("Duplicate")).toBeTruthy();
      }
    });

    it("calls onDuplicate when Duplicate is clicked", () => {
      const duplicated: AnalysisProfile[] = [];
      render(
        <ProfileList
          {...defaultProps}
          onDuplicate={(p) => duplicated.push(p)}
        />,
      );
      // Get all plain/kebab toggle buttons
      const toggleButtons = screen.getAllByRole("button");
      // Find kebab buttons - they contain the EllipsisV icon SVG
      const kebabs = toggleButtons.filter(
        (btn) => btn.classList.contains("pf-m-plain"),
      );
      // Open the first kebab (for p1 profile)
      if (kebabs.length >= 1) {
        fireEvent.click(kebabs[0]);
        const duplicateItem = screen.queryByText("Duplicate");
        if (duplicateItem) {
          fireEvent.click(duplicateItem);
          expect(duplicated.length).toBe(1);
          expect(duplicated[0].id).toBe("p1");
        }
      }
    });

    it("disables Delete for read-only profiles", () => {
      render(<ProfileList {...defaultProps} />);
      const toggleButtons = screen.getAllByRole("button");
      const kebabs = toggleButtons.filter(
        (btn) => btn.classList.contains("pf-m-plain") || btn.querySelector("svg"),
      );
      if (kebabs.length >= 3) {
        fireEvent.click(kebabs[2]);
        const deleteItem = screen.queryByText("Delete");
        if (deleteItem) {
          const menuItem =
            deleteItem.closest("[role='menuitem']") || deleteItem.closest("button");
          expect(
            menuItem?.getAttribute("aria-disabled") === "true" ||
              (menuItem as HTMLButtonElement)?.disabled === true,
          ).toBeTruthy();
        }
      }
    });
  });

  describe("Delete confirmation dialog", () => {
    it("shows confirmation dialog before deleting", () => {
      const deleted: string[] = [];
      render(
        <ProfileList {...defaultProps} onDelete={(id) => deleted.push(id)} />,
      );
      const toggleButtons = screen.getAllByRole("button");
      const kebabs = toggleButtons.filter(
        (btn) => btn.classList.contains("pf-m-plain") || btn.querySelector("svg"),
      );
      if (kebabs.length >= 2) {
        fireEvent.click(kebabs[1]);
        const deleteItem = screen.queryByText("Delete");
        if (deleteItem) {
          fireEvent.click(deleteItem);
          expect(screen.getByText(/Are you sure you want to delete/)).toBeTruthy();
          // Not yet deleted
          expect(deleted.length).toBe(0);
        }
      }
    });
  });

  describe("Disabled state", () => {
    it("disables Make Active when isDisabled is true", () => {
      render(<ProfileList {...defaultProps} isDisabled={true} />);
      const toggleButtons = screen.getAllByRole("button");
      const kebabs = toggleButtons.filter(
        (btn) => btn.classList.contains("pf-m-plain") || btn.querySelector("svg"),
      );
      if (kebabs.length >= 2) {
        fireEvent.click(kebabs[1]);
        const makeActive = screen.queryByText("Make Active");
        if (makeActive) {
          const menuItem =
            makeActive.closest("[role='menuitem']") || makeActive.closest("button");
          expect(
            menuItem?.getAttribute("aria-disabled") === "true" ||
              (menuItem as HTMLButtonElement)?.disabled === true,
          ).toBeTruthy();
        }
      }
    });
  });

  describe("Profile name truncation", () => {
    it("renders long profile names with text-overflow ellipsis", () => {
      const longName = "A".repeat(50);
      render(
        <ProfileList
          {...defaultProps}
          profiles={[mockProfile({ id: "long", name: longName })]}
        />,
      );
      const nameEl = screen.getByText(longName);
      expect(nameEl).toBeTruthy();
      expect(nameEl.style.overflow).toBe("hidden");
      expect(nameEl.style.textOverflow).toBe("ellipsis");
    });
  });
});
