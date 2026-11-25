import React from "react";
import { AGENT_SET_PERMISSION_MODE } from "@editor-extensions/shared";

export interface PermissionModeOption {
  value: string;
  label: string;
  /** A mode the agent is in that the picker does not offer (e.g. Goose's smart_approve). */
  disabled?: boolean;
}

const OFFERED: PermissionModeOption[] = [
  { value: "approve", label: "Ask before changes" },
  { value: "auto", label: "Auto-approve" },
];

/**
 * Options for the picker. The picker switches only between "approve" and
 * "auto"; if the agent is in another mode it set itself (Goose's
 * smart_approve or chat), that mode is shown, unselectable, so the picker
 * never misreports what is in effect.
 */
export function permissionModeOptions(current: string | null): PermissionModeOption[] {
  if (current && !OFFERED.some((o) => o.value === current)) {
    return [{ value: current, label: current.replace(/_/g, " "), disabled: true }, ...OFFERED];
  }
  return OFFERED;
}

interface PermissionModePickerProps {
  current: string | null;
}

/**
 * Shows the agent session's permission mode in the chat status bar and
 * switches it through the agent's ACP session modes. The extension applies
 * the choice to the current session and every later one, and saves it as
 * the konveyor-core.experimentalChat.permissionMode setting.
 */
export const PermissionModePicker: React.FC<PermissionModePickerProps> = ({ current }) => {
  const options = permissionModeOptions(current);
  return (
    <select
      className="chat-mode-select"
      aria-label="Agent permissions"
      title="Whether the agent asks before it edits files or runs commands"
      value={current ?? ""}
      onChange={(e) =>
        window.vscode.postMessage({
          type: AGENT_SET_PERMISSION_MODE,
          payload: { mode: e.target.value },
        })
      }
    >
      {current === null && (
        <option value="" disabled>
          Agent default
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
};
