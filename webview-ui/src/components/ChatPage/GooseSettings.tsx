import React, { useState, useEffect, useMemo } from "react";
import { useExtensionStore } from "../../store/store";
import { GOOSE_PROVIDERS, type GooseProviderOption } from "./gooseProviders";

interface GooseSettingsProps {
  onClose: () => void;
}

const GooseSettings: React.FC<GooseSettingsProps> = ({ onClose }) => {
  const gooseConfig = useExtensionStore((s) => s.gooseConfig);
  const gooseState = useExtensionStore((s) => s.gooseState);

  const [selectedProvider, setSelectedProvider] = useState(gooseConfig?.provider ?? "");
  const [modelInput, setModelInput] = useState(gooseConfig?.model ?? "");
  const [extensionStates, setExtensionStates] = useState<Record<string, boolean>>({});
  const [credentialInputs, setCredentialInputs] = useState<Record<string, string>>({});
  const [showModelSuggestions, setShowModelSuggestions] = useState(false);

  useEffect(() => {
    if (gooseConfig) {
      setSelectedProvider(gooseConfig.provider);
      setModelInput(gooseConfig.model);
      const states: Record<string, boolean> = {};
      for (const ext of gooseConfig.extensions) {
        states[ext.id] = ext.enabled;
      }
      setExtensionStates(states);
    }
  }, [gooseConfig]);

  const currentProviderOption: GooseProviderOption | undefined = useMemo(
    () => GOOSE_PROVIDERS.find((p) => p.id === selectedProvider),
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
    const extensionPayload = gooseConfig
      ? gooseConfig.extensions.map((ext) => ({
          id: ext.id,
          enabled: extensionStates[ext.id] ?? ext.enabled,
        }))
      : [];

    const hasCredentialValues = Object.values(credentialInputs).some((v) => v.length > 0);

    window.vscode.postMessage({
      type: "GOOSE_UPDATE_CONFIG",
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
    selectedProvider !== (gooseConfig?.provider ?? "") ||
    modelInput !== (gooseConfig?.model ?? "") ||
    Object.values(credentialInputs).some((v) => v.length > 0) ||
    gooseConfig?.extensions.some((ext) => extensionStates[ext.id] !== ext.enabled);

  const providerEnvVars = currentProviderOption?.envVars ?? [];
  const hasStoredCreds = gooseConfig?.hasStoredCredentials ?? false;

  return (
    <div className="goose-settings">
      <div className="goose-settings__header">
        <span className="goose-settings__title">Configuration</span>
        <button className="goose-settings__close" onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </div>

      {/* Provider Selection */}
      <div className="goose-settings__section">
        <label className="goose-settings__label" htmlFor="goose-provider">
          Provider
        </label>
        <select
          id="goose-provider"
          className="goose-settings__select"
          value={selectedProvider}
          onChange={handleProviderChange}
        >
          <option value="">Select a provider...</option>
          {GOOSE_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Model Input */}
      <div className="goose-settings__section">
        <label className="goose-settings__label" htmlFor="goose-model">
          Model
        </label>
        <div className="goose-settings__model-wrapper">
          <input
            id="goose-model"
            className="goose-settings__input"
            type="text"
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
            onFocus={() => setShowModelSuggestions(true)}
            onBlur={() => setTimeout(() => setShowModelSuggestions(false), 150)}
            placeholder="Enter model name..."
            autoComplete="off"
          />
          {showModelSuggestions && filteredModels.length > 0 && (
            <ul className="goose-settings__suggestions">
              {filteredModels.map((m) => (
                <li
                  key={m}
                  className="goose-settings__suggestion"
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
        <div className="goose-settings__section">
          <div className="goose-settings__section-divider" />
          <label className="goose-settings__label">
            Credentials
            {hasStoredCreds && (
              <span className="goose-settings__stored-badge">Stored</span>
            )}
          </label>
          <div className="goose-settings__credentials">
            {providerEnvVars.map((envVar) => (
              <div key={envVar.key} className="goose-settings__credential-field">
                <label
                  className="goose-settings__credential-label"
                  htmlFor={`cred-${envVar.key}`}
                >
                  {envVar.label}
                </label>
                <input
                  id={`cred-${envVar.key}`}
                  className="goose-settings__input"
                  type={envVar.isSecret ? "password" : "text"}
                  value={credentialInputs[envVar.key] ?? ""}
                  onChange={(e) => handleCredentialChange(envVar.key, e.target.value)}
                  placeholder={hasStoredCreds ? "Leave blank to keep current" : `Enter ${envVar.label.toLowerCase()}...`}
                  autoComplete="off"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {providerEnvVars.length === 0 && currentProviderOption && (
        <div className="goose-settings__credential-hint">No API key required</div>
      )}

      {/* Extensions */}
      {gooseConfig && gooseConfig.extensions.length > 0 && (
        <div className="goose-settings__section">
          <div className="goose-settings__section-divider" />
          <label className="goose-settings__label">Extensions</label>
          <div className="goose-settings__extensions">
            {gooseConfig.extensions.map((ext) => (
              <div key={ext.id} className="goose-settings__extension">
                <div className="goose-settings__extension-info">
                  <span className="goose-settings__extension-name">{ext.name}</span>
                  {ext.description && (
                    <span className="goose-settings__extension-desc">{ext.description}</span>
                  )}
                </div>
                <button
                  className={`goose-settings__toggle ${extensionStates[ext.id] ? "goose-settings__toggle--on" : ""}`}
                  onClick={() => handleToggleExtension(ext.id)}
                  role="switch"
                  aria-checked={extensionStates[ext.id] ?? false}
                  aria-label={`Toggle ${ext.name}`}
                >
                  <span className="goose-settings__toggle-track">
                    <span className="goose-settings__toggle-thumb" />
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="goose-settings__actions">
        <button
          className="goose-settings__btn goose-settings__btn--primary"
          onClick={handleApplyAndRestart}
          disabled={!selectedProvider || !modelInput}
          title={!hasChanges ? "No changes to apply" : "Apply changes and restart Goose"}
        >
          {gooseState === "running" ? "Apply & Restart" : "Apply & Start"}
        </button>
      </div>
    </div>
  );
};

export default GooseSettings;
