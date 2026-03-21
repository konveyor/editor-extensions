import React, { useState, useEffect, useMemo } from "react";
import type { ToolPermissionPolicy, ToolPermissionLevel } from "@editor-extensions/shared";
import { SET_TOOL_PERMISSIONS, OPEN_NATIVE_CONFIG } from "@editor-extensions/shared";
import { useExtensionStore } from "../../store/store";
import { AGENT_PROVIDERS, type AgentProviderOption } from "./agentProviders";

type OverrideValue = ToolPermissionLevel | "inherit";

const CATEGORY_LABELS: Record<string, string> = {
  fileEditing: "File Editing",
  commandExecution: "Command Execution",
  webAccess: "Web Access",
  mcpTools: "MCP / External Tools",
};

const CATEGORY_KEYS = ["fileEditing", "commandExecution", "webAccess", "mcpTools"] as const;

interface AgentSettingsProps {
  onClose: () => void;
}

const AgentSettings: React.FC<AgentSettingsProps> = ({ onClose }) => {
  const agentConfig = useExtensionStore((s) => s.agentConfig);
  const agentState = useExtensionStore((s) => s.agentState);
  const toolPermissions = useExtensionStore((s) => s.toolPermissions);

  const [selectedProvider, setSelectedProvider] = useState(agentConfig?.provider ?? "");
  const [modelInput, setModelInput] = useState(agentConfig?.model ?? "");
  const [extensionStates, setExtensionStates] = useState<Record<string, boolean>>({});
  const [credentialInputs, setCredentialInputs] = useState<Record<string, string>>({});
  const [showModelSuggestions, setShowModelSuggestions] = useState(false);

  const [autonomyLevel, setAutonomyLevel] = useState<"auto" | "smart" | "ask">(
    toolPermissions.autonomyLevel,
  );
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, OverrideValue>>({});

  useEffect(() => {
    if (agentConfig) {
      setSelectedProvider(agentConfig.provider);
      setModelInput(agentConfig.model);
      const states: Record<string, boolean> = {};
      for (const ext of agentConfig.extensions) {
        states[ext.id] = ext.enabled;
      }
      setExtensionStates(states);
    }
  }, [agentConfig]);

  useEffect(() => {
    setAutonomyLevel(toolPermissions.autonomyLevel);
    const overrides: Record<string, OverrideValue> = {};
    for (const key of CATEGORY_KEYS) {
      overrides[key] = toolPermissions.overrides?.[key] ?? "inherit";
    }
    setCategoryOverrides(overrides);
  }, [toolPermissions]);

  const currentProviderOption: AgentProviderOption | undefined = useMemo(
    () => AGENT_PROVIDERS.find((p) => p.id === selectedProvider),
    [selectedProvider],
  );

  const filteredModels = useMemo(() => {
    if (!currentProviderOption) {
      return [];
    }
    if (!modelInput) {
      return currentProviderOption.commonModels;
    }
    return currentProviderOption.commonModels.filter((m) =>
      m.toLowerCase().includes(modelInput.toLowerCase()),
    );
  }, [currentProviderOption, modelInput]);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value;
    setSelectedProvider(newProvider);
    setModelInput("");
    setCredentialInputs({});
  };

  const handleCredentialChange = (key: string, value: string) => {
    setCredentialInputs((prev) => ({ ...prev, [key]: value }));
  };

  const handleToggleExtension = (extId: string) => {
    setExtensionStates((prev) => ({ ...prev, [extId]: !prev[extId] }));
  };

  const buildPermissionPolicy = (): ToolPermissionPolicy => {
    const overrides: Record<string, ToolPermissionLevel> = {};
    for (const key of CATEGORY_KEYS) {
      const val = categoryOverrides[key];
      if (val && val !== "inherit") {
        overrides[key] = val;
      }
    }
    return {
      autonomyLevel,
      overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
      source: toolPermissions.source,
    };
  };

  const permissionsChanged = (): boolean => {
    if (autonomyLevel !== toolPermissions.autonomyLevel) return true;
    for (const key of CATEGORY_KEYS) {
      const current = categoryOverrides[key] ?? "inherit";
      const stored = toolPermissions.overrides?.[key] ?? "inherit";
      if (current !== stored) return true;
    }
    return false;
  };

  const handleApplyAndRestart = () => {
    const extensionPayload = agentConfig
      ? agentConfig.extensions.map((ext) => ({
          id: ext.id,
          enabled: extensionStates[ext.id] ?? ext.enabled,
        }))
      : [];

    const hasCredentialValues = Object.values(credentialInputs).some((v) => v.length > 0);

    if (permissionsChanged()) {
      window.vscode.postMessage({
        type: SET_TOOL_PERMISSIONS,
        payload: { policy: buildPermissionPolicy() },
      });
    }

    window.vscode.postMessage({
      type: "AGENT_UPDATE_CONFIG",
      payload: {
        provider: selectedProvider,
        model: modelInput,
        extensions: extensionPayload,
        ...(hasCredentialValues ? { credentials: credentialInputs } : {}),
      },
    });
    onClose();
  };

  const hasChanges =
    selectedProvider !== (agentConfig?.provider ?? "") ||
    modelInput !== (agentConfig?.model ?? "") ||
    Object.values(credentialInputs).some((v) => v.length > 0) ||
    agentConfig?.extensions.some((ext) => extensionStates[ext.id] !== ext.enabled) ||
    permissionsChanged();

  const providerEnvVars = currentProviderOption?.envVars ?? [];
  const hasStoredCreds = agentConfig?.hasStoredCredentials ?? false;

  return (
    <div className="agent-settings">
      <div className="agent-settings__header">
        <span className="agent-settings__title">Configuration</span>
        <button className="agent-settings__close" onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </div>

      {/* Provider Selection */}
      <div className="agent-settings__section">
        <label className="agent-settings__label" htmlFor="agent-provider">
          Provider
        </label>
        <select
          id="agent-provider"
          className="agent-settings__select"
          value={selectedProvider}
          onChange={handleProviderChange}
        >
          <option value="">Select a provider...</option>
          {AGENT_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Model Input */}
      <div className="agent-settings__section">
        <label className="agent-settings__label" htmlFor="agent-model">
          Model
        </label>
        <div className="agent-settings__model-wrapper">
          <input
            id="agent-model"
            className="agent-settings__input"
            type="text"
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
            onFocus={() => setShowModelSuggestions(true)}
            onBlur={() => setTimeout(() => setShowModelSuggestions(false), 150)}
            placeholder="Enter model name..."
            autoComplete="off"
          />
          {showModelSuggestions && filteredModels.length > 0 && (
            <ul className="agent-settings__suggestions">
              {filteredModels.map((m) => (
                <li
                  key={m}
                  className="agent-settings__suggestion"
                  onMouseDown={() => {
                    setModelInput(m);
                    setShowModelSuggestions(false);
                  }}
                >
                  {m}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Credentials */}
      {providerEnvVars.length > 0 && (
        <div className="agent-settings__section">
          <div className="agent-settings__section-divider" />
          <label className="agent-settings__label">
            Credentials
            {hasStoredCreds && <span className="agent-settings__stored-badge">Stored</span>}
          </label>
          <div className="agent-settings__credentials">
            {providerEnvVars.map((envVar) => (
              <div key={envVar.key} className="agent-settings__credential-field">
                <label className="agent-settings__credential-label" htmlFor={`cred-${envVar.key}`}>
                  {envVar.label}
                </label>
                <input
                  id={`cred-${envVar.key}`}
                  className="agent-settings__input"
                  type={envVar.isSecret ? "password" : "text"}
                  value={credentialInputs[envVar.key] ?? ""}
                  onChange={(e) => handleCredentialChange(envVar.key, e.target.value)}
                  placeholder={
                    hasStoredCreds
                      ? "Leave blank to keep current"
                      : `Enter ${envVar.label.toLowerCase()}...`
                  }
                  autoComplete="off"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {providerEnvVars.length === 0 && currentProviderOption && (
        <div className="agent-settings__credential-hint">No API key required</div>
      )}

      {/* Extensions */}
      {agentConfig && agentConfig.extensions.length > 0 && (
        <div className="agent-settings__section">
          <div className="agent-settings__section-divider" />
          <label className="agent-settings__label">Extensions</label>
          <div className="agent-settings__extensions">
            {agentConfig.extensions.map((ext) => (
              <div key={ext.id} className="agent-settings__extension">
                <div className="agent-settings__extension-info">
                  <span className="agent-settings__extension-name">{ext.name}</span>
                  {ext.description && (
                    <span className="agent-settings__extension-desc">{ext.description}</span>
                  )}
                </div>
                <button
                  className={`agent-settings__toggle ${extensionStates[ext.id] ? "agent-settings__toggle--on" : ""}`}
                  onClick={() => handleToggleExtension(ext.id)}
                  role="switch"
                  aria-checked={extensionStates[ext.id] ?? false}
                  aria-label={`Toggle ${ext.name}`}
                >
                  <span className="agent-settings__toggle-track">
                    <span className="agent-settings__toggle-thumb" />
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tool Permissions */}
      <div className="agent-settings__section">
        <div className="agent-settings__section-divider" />
        <label className="agent-settings__label">
          Tool Permissions
          {toolPermissions.source === "hub" && (
            <span className="agent-settings__stored-badge">Set by organization</span>
          )}
        </label>

        <div className="agent-settings__permission-row">
          <span className="agent-settings__permission-label">Autonomy Level</span>
          <select
            className="agent-settings__permission-select"
            value={autonomyLevel}
            onChange={(e) => setAutonomyLevel(e.target.value as "auto" | "smart" | "ask")}
            disabled={toolPermissions.source === "hub"}
          >
            <option value="auto">Auto</option>
            <option value="smart">Smart</option>
            <option value="ask">Ask</option>
          </select>
        </div>

        <div className="agent-settings__permission-overrides">
          <span className="agent-settings__permission-overrides-header">Category Overrides</span>
          {CATEGORY_KEYS.map((key) => (
            <div key={key} className="agent-settings__permission-row">
              <span className="agent-settings__permission-label">{CATEGORY_LABELS[key]}</span>
              <select
                className="agent-settings__permission-select"
                value={categoryOverrides[key] ?? "inherit"}
                onChange={(e) =>
                  setCategoryOverrides((prev) => ({
                    ...prev,
                    [key]: e.target.value as OverrideValue,
                  }))
                }
                disabled={toolPermissions.source === "hub"}
              >
                <option value="inherit">Inherit</option>
                <option value="auto">Auto</option>
                <option value="ask">Ask</option>
                <option value="deny">Deny</option>
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Advanced */}
      <div className="agent-settings__section">
        <div className="agent-settings__section-divider" />
        <button
          className="agent-settings__link-btn"
          onClick={() =>
            window.vscode.postMessage({ type: OPEN_NATIVE_CONFIG, payload: {} })
          }
        >
          Open native configuration file
        </button>
      </div>

      {/* Actions */}
      <div className="agent-settings__actions">
        <button
          className="agent-settings__btn agent-settings__btn--primary"
          onClick={handleApplyAndRestart}
          disabled={!selectedProvider || !modelInput}
          title={!hasChanges ? "No changes to apply" : "Apply changes and restart agent"}
        >
          {agentState === "running" ? "Apply & Restart" : "Apply & Start"}
        </button>
      </div>
    </div>
  );
};

export default AgentSettings;
