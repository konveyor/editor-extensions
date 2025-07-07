import { window, QuickPickItem, Disposable } from "vscode";
import { getConfigLabelSelector, updateLabelSelector } from "./utilities/configuration";
import { sourceOptions, targetOptions } from "./config/labels";
import { buildLabelSelector } from "@editor-extensions/shared";

function extractValuesFromSelector(selector: string, key: string): string[] {
  const regex = new RegExp(`konveyor.io/${key}=([\\w.-]+)`, "g");
  const matches = selector.matchAll(regex);
  const values = Array.from(matches, (match) => match[1]);
  return values.flatMap((value) => value.split("|"));
}

export async function configureSourcesTargetsQuickPick() {
  const currentLabelSelector = getConfigLabelSelector();
  const currentSources = extractValuesFromSelector(currentLabelSelector, "source");
  const currentTargets = extractValuesFromSelector(currentLabelSelector, "target");

  const state = {
    sources: [...currentSources],
    targets: [...currentTargets],
    labelSelector: "",
  };

  await showMultiSelectQuickPick({
    title: "Select Target Technologies",
    placeholder: "Choose one or more target technologies",
    options: targetOptions,
    initiallySelected: state.targets,
    onSelectionChange: async (currentlySelected) => {
      state.targets = currentlySelected;
      state.labelSelector = buildLabelSelector(state.sources, state.targets);
      await updateLabelSelector(state.labelSelector);
    },
  });

  await showMultiSelectQuickPick({
    title: "Select Source Technologies",
    placeholder: "Choose one or more source technologies",
    options: sourceOptions,
    initiallySelected: state.sources,
    onSelectionChange: async (currentlySelected) => {
      state.sources = currentlySelected;
      state.labelSelector = buildLabelSelector(state.sources, state.targets);
      await updateLabelSelector(state.labelSelector);
    },
  });

  window.showInformationMessage(`Label Selector Updated: ${state.labelSelector}`);
}

/**
 * showMultiSelectQuickPick
 * A reusable helper to create a QuickPick for multi-select. It:
 * - Shows a list of items (options)
 * - Preselects any items in `initiallySelected`
 * - Calls `onSelectionChange` whenever the user checks or unchecks an item
 * - Resolves when the user hits Enter OR Escape (onDidAccept / onDidHide)
 */
async function showMultiSelectQuickPick(params: {
  title: string;
  placeholder: string;
  options: string[];
  initiallySelected: string[];
  onSelectionChange: (selected: string[]) => Promise<void>;
}): Promise<void> {
  return new Promise<void>((resolve) => {
    const { title, placeholder, options, initiallySelected, onSelectionChange } = params;

    const quickPick = window.createQuickPick<QuickPickItem>();
    quickPick.title = title;
    quickPick.placeholder = placeholder;
    quickPick.canSelectMany = true;

    // Create QuickPick items
    const allItems: QuickPickItem[] = options.map((option) => ({ label: option }));
    quickPick.items = allItems;

    // Pre-select the items that match 'initiallySelected'
    quickPick.selectedItems = allItems.filter((item) => initiallySelected.includes(item.label));

    // Listen for selection changes in real time
    const disposables: Disposable[] = [];

    disposables.push(
      quickPick.onDidChangeSelection(async (selectedItems) => {
        const labels = selectedItems.map((item) => item.label);
        await onSelectionChange(labels);
      }),
    );

    // Accept (user pressed Enter)
    disposables.push(
      quickPick.onDidAccept(() => {
        quickPick.hide();
      }),
    );

    // Hide (user pressed Esc or otherwise closed)
    disposables.push(
      quickPick.onDidHide(() => {
        disposables.forEach((d) => d.dispose());
        resolve();
      }),
    );

    // Finally, show the QuickPick
    quickPick.show();
  });
}
