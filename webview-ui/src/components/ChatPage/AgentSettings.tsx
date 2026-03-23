import React, { useState, useEffect, useMemo } from "react";
import type { ToolPermissionPolicy, ToolPermissionLevel } from "@editor-extensions/shared";
import {
  SET_TOOL_PERMISSIONS,
  OPEN_NATIVE_CONFIG,
  SET_EXPERIMENTAL_CHAT,
} from "@editor-extensions/shared";
import { useExtensionStore } from "../../store/store";
import { PROVIDERS, type ProviderOption } from "./providerOptions";

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
  const experimentalChatEnabled = useExtensionStore((s) => s.experimentalChatEnabled);

  const [selectedProvider, setSelectedProvider] = useState(agentConfig?.provider ?? "");
  const [modelInput, setModelInput] = useState(agentConfig?.model ?? "");
  const [agentModeEnabled, setAgentModeEnabled] = useState(agentConfig?.agentMode ?? true);
  const [extensionStates, setExtensionStates] = useState<Record<string, boolean>>({});
  const [credentialInputs, setCredentialInputs] = useState<Record<string, string>>({});
  const [showModelSuggestions, setShowModelSuggestions] = useState(false);

  // Tool permission local state
  const [autonomyLevel, setAutonomyLevel] = useState<"auto" | "smart" | "ask">(
    toolPermissions.autonomyLevel,
  );
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, OverrideValue>>({});

  useEffect(() => {
    if (agentConfig) {
      setSelectedProvider(agentConfig.provider);
      setModelInput(agentConfig.model);
      setAgentModeEnabled(agentConfig.agentMode);
      const states: Record<string, boolean> = {};
      for (const ext of agentConfig.capabilities) {
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

  const currentProviderOption: ProviderOption | undefined = useMemo(
    () => PROVIDERS.find((p) => p.id === selectedProvider),
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
      ? agentConfig.capabilities.map((ext) => ({
          id: ext.id,
          enabled: extensionStates[ext.id] ?? ext.enabled,
        }))
      : [];

    const hasCredentialValues = Object.values(credentialInputs).some((v) => v.length > 0);

    if (agentModeEnabled) {
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
          agentMode: agentModeEnabled,
          extensions: extensionPayload,
          ...(hasCredentialValues ? { credentials: credentialInputs } : {}),
        },
      });
    } else {
      window.vscode.postMessage({
        type: "UPDATE_MODEL_PROVIDER_CONFIG",
        payload: {
          provider: selectedProvider,
          model: modelInput,
          agentMode: agentModeEnabled,
          ...(hasCredentialValues ? { credentials: credentialInputs } : {}),
        },
      });
    }

    onClose();
  };

  const hasChanges =
    selectedProvider !== (agentConfig?.provider ?? "") ||
    modelInput !== (agentConfig?.model ?? "") ||
    agentModeEnabled !== (agentConfig?.agentMode ?? true) ||
    Object.values(credentialInputs).some((v) => v.length > 0) ||
    agentConfig?.capabilities.some((ext) => extensionStates[ext.id] !== ext.enabled) ||
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

      {/* Actions */}
      <div className="agent-settings__actions">
        <button
          className="agent-settings__btn agent-settings__btn--primary"
          onClick={handleApplyAndRestart}
          disabled={!selectedProvider || !modelInput}
          title={agentModeEnabled ? (!hasChanges ? "No changes to apply" : "Apply changes and restart agent") : "Apply model configuration"}
        >
          {agentModeEnabled ? (agentState === "running" ? "Apply & Restart" : "Apply & Start") : "Apply"}
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
          {PROVIDERS.map((p) => (
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

      {/* Agent Mode — always visible */}
      <div className="agent-settings__section">
        <div className="agent-settings__section-divider" />
        <div className="agent-settings__permission-row">
          <div>
            <span className="agent-settings__permission-label">Agent Mode</span>
            <div className="agent-settings__agent-mode-hint">
              {agentModeEnabled
                ? "Full autonomy — agent explores and fixes broadly"
                : "Focused fix — agent addresses specific incidents only"}
            </div>
          </div>
          <button
            className={`agent-settings__toggle ${agentModeEnabled ? "agent-settings__toggle--on" : ""}`}
            onClick={() => setAgentModeEnabled((prev) => !prev)}
            role="switch"
            aria-checked={agentModeEnabled}
            aria-label="Toggle Agent Mode"
          >
            <span className="agent-settings__toggle-track">
              <span className="agent-settings__toggle-thumb" />
            </span>
          </button>
        </div>
      </div>

      {/* Experimental Chat */}
      <div className="agent-settings__section">
        <div className="agent-settings__permission-row">
          <div>
            <span className="agent-settings__permission-label">Experimental Chat</span>
            <div className="agent-settings__agent-mode-hint">
              {experimentalChatEnabled
                ? "Agent-powered chat with start/stop controls"
                : "Enable to use the full AI agent chat experience"}
            </div>
          </div>
          <button
            className={`agent-settings__toggle ${experimentalChatEnabled ? "agent-settings__toggle--on" : ""}`}
            onClick={() => {
              const newValue = !experimentalChatEnabled;
              useExtensionStore.getState().setExperimentalChatEnabled(newValue);
              window.vscode.postMessage({
                type: SET_EXPERIMENTAL_CHAT,
                payload: { enabled: newValue },
              });
            }}
            role="switch"
            aria-checked={experimentalChatEnabled}
            aria-label="Toggle Experimental Chat"
          >
            <span className="agent-settings__toggle-track">
              <span className="agent-settings__toggle-thumb" />
            </span>
          </button>
        </div>
      </div>

      {agentModeEnabled && (
        <>
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

          {/* Extensions */}
          {agentConfig && agentConfig.capabilities.length > 0 && (
            <div className="agent-settings__section">
              <div className="agent-settings__section-divider" />
              <label className="agent-settings__label">Extensions</label>
              <div className="agent-settings__extensions">
                {agentConfig.capabilities.map((ext) => (
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
        </>
      )}

    </div>
  );
};

export default AgentSettings;
