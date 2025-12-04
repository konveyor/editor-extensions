import React, { useState, useEffect, useMemo } from "react";
import {
  Button,
  Form,
  FormGroup,
  FormSection,
  ActionGroup,
  TextInput,
  Switch,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Alert,
} from "@patternfly/react-core";
import { ExclamationCircleIcon, InfoCircleIcon } from "@patternfly/react-icons";
import { sendVscodeMessage as dispatch } from "../../utils/vscodeMessaging";
import { HubConfig } from "@editor-extensions/shared";

export const HubSettingsForm: React.FC<{
  initialConfig: HubConfig;
}> = ({ initialConfig }) => {
  const [formData, setFormData] = useState<HubConfig>(initialConfig);
  const [isDirty, setIsDirty] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Validation state
  const [urlValidation, setUrlValidation] = useState<"default" | "error">("default");
  const [urlErrorMsg, setUrlErrorMsg] = useState<string | null>(null);
  const [realmValidation, setRealmValidation] = useState<"default" | "error">("default");
  const [realmErrorMsg, setRealmErrorMsg] = useState<string | null>(null);
  const [usernameValidation, setUsernameValidation] = useState<"default" | "error">("default");
  const [usernameErrorMsg, setUsernameErrorMsg] = useState<string | null>(null);
  const [passwordValidation, setPasswordValidation] = useState<"default" | "error">("default");
  const [passwordErrorMsg, setPasswordErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setFormData(initialConfig);
    setIsDirty(false);
    setSaveSuccess(false);
  }, [initialConfig]);

  useEffect(() => {
    // Check if form data is different from initial config
    const hasChanges = JSON.stringify(formData) !== JSON.stringify(initialConfig);
    setIsDirty(hasChanges);
    if (hasChanges) {
      setSaveSuccess(false);
    }
  }, [formData, initialConfig]);

  const validateUrl = (url: string, enabled: boolean): boolean => {
    if (enabled && !url.trim()) {
      setUrlValidation("error");
      setUrlErrorMsg("Hub URL is required when hub is enabled.");
      return false;
    }

    if (url.trim() && !url.match(/^https?:\/\/.+/)) {
      setUrlValidation("error");
      setUrlErrorMsg("URL must start with http:// or https://");
      return false;
    }

    setUrlValidation("default");
    setUrlErrorMsg(null);
    return true;
  };

  const validateRealm = (realm: string, authEnabled: boolean): boolean => {
    if (authEnabled && !realm.trim()) {
      setRealmValidation("error");
      setRealmErrorMsg("Realm is required when authentication is enabled.");
      return false;
    }

    setRealmValidation("default");
    setRealmErrorMsg(null);
    return true;
  };

  const validateUsername = (username: string, authEnabled: boolean): boolean => {
    if (authEnabled && !username.trim()) {
      setUsernameValidation("error");
      setUsernameErrorMsg("Username is required when authentication is enabled.");
      return false;
    }

    setUsernameValidation("default");
    setUsernameErrorMsg(null);
    return true;
  };

  const validatePassword = (password: string, authEnabled: boolean): boolean => {
    if (authEnabled && !password.trim()) {
      setPasswordValidation("error");
      setPasswordErrorMsg("Password is required when authentication is enabled.");
      return false;
    }

    setPasswordValidation("default");
    setPasswordErrorMsg(null);
    return true;
  };

  const isFormValid = useMemo(() => {
    // Check URL validation
    if (formData.enabled && !formData.url.trim()) {
      return false;
    }
    if (formData.url.trim() && !formData.url.match(/^https?:\/\/.+/)) {
      return false;
    }

    // Check auth validation
    if (formData.auth.enabled) {
      if (!formData.auth.realm.trim()) {
        return false;
      }
      if (!formData.auth.username.trim()) {
        return false;
      }
      if (!formData.auth.password.trim()) {
        return false;
      }
    }

    return true;
  }, [formData]);

  const handleSave = () => {
    // Re-validate before saving to update error messages
    const urlValid = validateUrl(formData.url, formData.enabled);
    const realmValid = validateRealm(formData.auth.realm, formData.auth.enabled);
    const usernameValid = validateUsername(formData.auth.username, formData.auth.enabled);
    const passwordValid = validatePassword(formData.auth.password, formData.auth.enabled);

    if (!urlValid || !realmValid || !usernameValid || !passwordValid) {
      return;
    }

    dispatch({
      type: "UPDATE_HUB_CONFIG",
      payload: formData,
    });

    setSaveSuccess(true);
    setIsDirty(false);

    // Hide success message after 3 seconds
    setTimeout(() => {
      setSaveSuccess(false);
    }, 3000);
  };

  const handleReset = () => {
    setFormData(initialConfig);
    setIsDirty(false);
    setSaveSuccess(false);
    setUrlValidation("default");
    setUrlErrorMsg(null);
    setRealmValidation("default");
    setRealmErrorMsg(null);
    setUsernameValidation("default");
    setUsernameErrorMsg(null);
    setPasswordValidation("default");
    setPasswordErrorMsg(null);
  };

  const updateField = <K extends keyof HubConfig>(field: K, value: HubConfig[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const updateAuthField = <K extends keyof HubConfig["auth"]>(
    field: K,
    value: HubConfig["auth"][K],
  ) => {
    setFormData((prev) => ({
      ...prev,
      auth: { ...prev.auth, [field]: value },
    }));
  };

  const updateFeatureField = <K extends keyof HubConfig["features"]>(
    feature: K,
    field: keyof HubConfig["features"][K],
    value: boolean,
  ) => {
    setFormData((prev) => ({
      ...prev,
      features: {
        ...prev.features,
        [feature]: {
          ...prev.features[feature],
          [field]: value,
        },
      },
    }));
  };

  return (
    <Form isWidthLimited>
      {saveSuccess && (
        <Alert
          variant="success"
          title="Hub configuration saved successfully"
          isInline
          style={{ marginBottom: "1rem" }}
        />
      )}

      <FormSection title="General Settings">
        <FormGroup label="Enable Hub" fieldId="hub-enabled">
          <Switch
            id="hub-enabled"
            label="Enable connection to Konveyor Hub"
            isChecked={formData.enabled}
            onChange={(_e, checked) => updateField("enabled", checked)}
          />
          <FormHelperText>
            <HelperText>
              <HelperTextItem icon={<InfoCircleIcon />}>
                Enable connection to Konveyor Hub for advanced features
              </HelperTextItem>
            </HelperText>
          </FormHelperText>
        </FormGroup>

        <FormGroup label="Hub URL" fieldId="hub-url" isRequired={formData.enabled}>
          <TextInput
            id="hub-url"
            type="url"
            value={formData.url}
            onChange={(_e, value) => {
              updateField("url", value);
              validateUrl(value, formData.enabled);
            }}
            validated={urlValidation}
            placeholder="http://localhost:8080"
          />
          {urlErrorMsg ? (
            <FormHelperText>
              <HelperText>
                <HelperTextItem icon={<ExclamationCircleIcon />} variant="error">
                  {urlErrorMsg}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          ) : (
            <FormHelperText>
              <HelperText>
                <HelperTextItem icon={<InfoCircleIcon />}>
                  The URL of your Konveyor Hub instance
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          )}
        </FormGroup>
      </FormSection>

      <FormSection title="Authentication">
        <FormGroup label="Enable authentication" fieldId="auth-enabled">
          <Switch
            id="auth-enabled"
            label="Enable authentication for Hub connection"
            isChecked={formData.auth.enabled}
            onChange={(_e, checked) => updateAuthField("enabled", checked)}
          />
        </FormGroup>

        <FormGroup label="Realm" fieldId="auth-realm" isRequired={formData.auth.enabled}>
          <TextInput
            id="auth-realm"
            value={formData.auth.realm}
            onChange={(_e, value) => {
              updateAuthField("realm", value);
              validateRealm(value, formData.auth.enabled);
            }}
            validated={realmValidation}
            placeholder="tackle"
            isDisabled={!formData.auth.enabled}
          />
          {realmErrorMsg ? (
            <FormHelperText>
              <HelperText>
                <HelperTextItem icon={<ExclamationCircleIcon />} variant="error">
                  {realmErrorMsg}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          ) : (
            <FormHelperText>
              <HelperText>
                <HelperTextItem icon={<InfoCircleIcon />}>
                  The authentication realm name
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          )}
        </FormGroup>

        <FormGroup label="Username" fieldId="auth-username" isRequired={formData.auth.enabled}>
          <TextInput
            id="auth-username"
            value={formData.auth.username}
            onChange={(_e, value) => {
              updateAuthField("username", value);
              validateUsername(value, formData.auth.enabled);
            }}
            validated={usernameValidation}
            placeholder="admin"
            isDisabled={!formData.auth.enabled}
          />
          {usernameErrorMsg ? (
            <FormHelperText>
              <HelperText>
                <HelperTextItem icon={<ExclamationCircleIcon />} variant="error">
                  {usernameErrorMsg}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          ) : (
            <FormHelperText>
              <HelperText>
                <HelperTextItem icon={<InfoCircleIcon />}>
                  Username for authenticating to the Hub
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          )}
        </FormGroup>

        <FormGroup label="Password" fieldId="auth-password" isRequired={formData.auth.enabled}>
          <TextInput
            id="auth-password"
            type="password"
            value={formData.auth.password}
            onChange={(_e, value) => {
              updateAuthField("password", value);
              validatePassword(value, formData.auth.enabled);
            }}
            validated={passwordValidation}
            placeholder="Enter password"
            isDisabled={!formData.auth.enabled}
          />
          {passwordErrorMsg ? (
            <FormHelperText>
              <HelperText>
                <HelperTextItem icon={<ExclamationCircleIcon />} variant="error">
                  {passwordErrorMsg}
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          ) : (
            <FormHelperText>
              <HelperText>
                <HelperTextItem icon={<InfoCircleIcon />}>
                  Password for authenticating to the Hub
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          )}
        </FormGroup>

        <FormGroup label="Insecure connection" fieldId="auth-insecure">
          <Switch
            id="auth-insecure"
            label="Skip SSL certificate verification"
            isChecked={formData.auth.insecure}
            onChange={(_e, checked) => updateAuthField("insecure", checked)}
            isDisabled={!formData.auth.enabled}
          />
          <FormHelperText>
            <HelperText>
              <HelperTextItem
                icon={<ExclamationCircleIcon />}
                variant={formData.auth.insecure ? "warning" : "default"}
              >
                {formData.auth.insecure
                  ? "Warning: Insecure connections skip SSL certificate verification"
                  : "Not recommended for production environments"}
              </HelperTextItem>
            </HelperText>
          </FormHelperText>
        </FormGroup>
      </FormSection>

      <FormSection title="Features">
        <FormGroup label="Solution Server" fieldId="feature-solution-server">
          <Switch
            id="feature-solution-server"
            label="Enable AI-powered solution generation"
            isChecked={formData.features.solutionServer.enabled}
            onChange={(_e, checked) => updateFeatureField("solutionServer", "enabled", checked)}
          />
          <FormHelperText>
            <HelperText>
              <HelperTextItem icon={<InfoCircleIcon />}>
                Enable AI-powered solution generation from the Hub
              </HelperTextItem>
            </HelperText>
          </FormHelperText>
        </FormGroup>

        {/* 
        TODO: Uncomment when the profile sync feature is implemented
        <FormGroup label="Profile Sync" fieldId="feature-profile-sync">
          <Switch
            id="feature-profile-sync"
            label="Synchronize analysis profiles"
            isChecked={formData.features.profileSync.enabled}
            onChange={(_e, checked) => updateFeatureField("profileSync", "enabled", checked)}
          />
          <FormHelperText>
            <HelperText>
              <HelperTextItem icon={<InfoCircleIcon />}>
                Synchronize analysis profiles with the Hub
              </HelperTextItem>
            </HelperText>
          </FormHelperText>
        </FormGroup> */}
      </FormSection>

      <ActionGroup>
        <Button variant="primary" onClick={handleSave} isDisabled={!isDirty || !isFormValid}>
          Save
        </Button>
        <Button variant="secondary" onClick={handleReset} isDisabled={!isDirty}>
          Reset
        </Button>
      </ActionGroup>
    </Form>
  );
};
