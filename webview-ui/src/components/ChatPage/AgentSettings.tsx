import React, { useState, useEffect, useMemo } from "react";
import { OPEN_NATIVE_CONFIG } from "@editor-extensions/shared";
import { useExtensionStore } from "../../store/store";
import { PROVIDERS, type ProviderOption } from "./providerOptions";

interface AgentSettingsProps {
  onClose: () => void;
}

const AgentSettings: React.FC<AgentSettingsProps> = ({ onClose }) => {
  const agentConfig = useExtensionStore((s) => s.agentConfig);
  const agentState = useExtensionStore((s) => s.agentState);
  // Agent Mode is toggled from the analysis view toolbar; here it only decides
  // whether "Apply" configures the ACP agent or the direct LLM client.
  const agentModeEnabled = useExtensionStore((s) => s.isAgentMode);

  const [selectedProvider, setSelectedProvider] = useState(agentConfig?.provider ?? "");
  const [modelInput, setModelInput] = useState(agentConfig?.model ?? "");
  const [extensionStates, setExtensionStates] = useState<Record<string, boolean>>({});
  const [credentialInputs, setCredentialInputs] = useState<Record<string, string>>({});
  const [showModelSuggestions, setShowModelSuggestions] = useState(false);

  useEffect(() => {
    if (agentConfig) {
      setSelectedProvider(agentConfig.provider);
      setModelInput(agentConfig.model);
      const states: Record<string, boolean> = {};
      for (const ext of agentConfig.capabilities) {
        states[ext.id] = ext.enabled;
      }
      setExtensionStates(states);
    }
  }, [agentConfig]);

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

  const handleApplyAndRestart = () => {
    const extensionPayload = agentConfig
      ? agentConfig.capabilities.map((ext) => ({
          id: ext.id,
          enabled: extensionStates[ext.id] ?? ext.enabled,
        }))
      : [];

    const hasCredentialValues = Object.values(credentialInputs).some((v) => v.length > 0);

    if (agentModeEnabled) {
      window.vscode.postMessage({
        type: "AGENT_UPDATE_CONFIG",
        payload: {
          provider: selectedProvider,
          model: modelInput,
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
          ...(hasCredentialValues ? { credentials: credentialInputs } : {}),
        },
      });
    }

    onClose();
  };

  const hasChanges =
    selectedProvider !== (agentConfig?.provider ?? "") ||
    modelInput !== (agentConfig?.model ?? "") ||
    Object.values(credentialInputs).some((v) => v.length > 0) ||
    agentConfig?.capabilities.some((ext) => extensionStates[ext.id] !== ext.enabled);

  const providerEnvVars = currentProviderOption?.envVars ?? [];
  const hasStoredCreds = agentConfig?.hasStoredCredentials ?? false;
  // Required fields may be left blank only when a stored value can be kept.
  const missingRequired = providerEnvVars.filter(
    (envVar) => envVar.required && !credentialInputs[envVar.key] && !hasStoredCreds,
  );

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
          disabled={!selectedProvider || !modelInput || missingRequired.length > 0}
          title={
            missingRequired.length > 0
              ? `Required: ${missingRequired.map((v) => v.label).join(", ")}`
              : agentModeEnabled
                ? !hasChanges
                  ? "No changes to apply"
                  : "Apply changes and restart agent"
                : "Apply model configuration"
          }
        >
          {agentModeEnabled
            ? agentState === "running"
              ? "Apply & Restart"
              : "Apply & Start"
            : "Apply"}
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
                  {envVar.required && !hasStoredCreds && " *"}
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

      {agentModeEnabled && (
        <>
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

          {/* Advanced – only Goose has a user-editable native config file */}
          {agentConfig?.backend !== "opencode" && (
            <div className="agent-settings__section">
              <div className="agent-settings__section-divider" />
              <button
                className="agent-settings__link-btn"
                onClick={() => window.vscode.postMessage({ type: OPEN_NATIVE_CONFIG, payload: {} })}
              >
                Open native configuration file
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AgentSettings;
