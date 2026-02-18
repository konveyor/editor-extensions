import React, { useEffect, useRef, useState } from "react";
import { targetOptions, sourceOptions } from "./options";
import {
  Button,
  Form,
  FormGroup,
  TextInput,
  Switch,
  Flex,
  FlexItem,
  FormHelperText,
  HelperText,
  HelperTextItem,
  FormAlert,
  Alert,
  Label,
  LabelGroup,
  Tooltip,
  StackItem,
  Stack,
  Title,
  Icon,
} from "@patternfly/react-core";
import {
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  StarIcon,
  InfoCircleIcon,
} from "@patternfly/react-icons";
import { sendVscodeMessage as dispatch } from "../../utils/vscodeMessaging";
import {
  AnalysisProfile,
  CONFIGURE_CUSTOM_RULES,
  UPLOAD_CUSTOM_RULES,
} from "@editor-extensions/shared";
import { useExtensionStore } from "../../store/store";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { CreatableMultiSelectField } from "./CreatableMultiSelectField";
import { buildLabelSelector } from "@editor-extensions/shared";
import { getBrandName } from "../../utils/branding";

const MAX_PROFILE_NAME_LENGTH = 24;

function useDebouncedCallback(callback: (...args: any[]) => void, delay: number) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isPending, setIsPending] = useState(false);

  return {
    callback: (...args: any[]) => {
      setIsPending(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args);
        setIsPending(false);
      }, delay);
    },
    isPending,
  };
}

export const ProfileEditorForm: React.FC<{
  profile: AnalysisProfile;
  isActive: boolean;
  onChange: (profile: AnalysisProfile) => void;
  onDelete: (id: string) => void;
  onMakeActive: (id: string) => void;
  allProfiles: AnalysisProfile[];
  isDisabled?: boolean;
}> = ({ profile, isActive, onChange, onDelete, onMakeActive, allProfiles, isDisabled = false }) => {
  const isWebEnvironment = useExtensionStore((state) => state.isWebEnvironment);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localProfile, setLocalProfile] = useState(profile);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);

  const [nameValidation, setNameValidation] = useState<"default" | "error">("default");
  const [nameErrorMsg, setNameErrorMsg] = useState<string | null>(null);

  const [targetsValidation, setTargetsValidation] = useState<"default" | "error">("default");
  const [targetsErrorMsg, setTargetsErrorMsg] = useState<string | null>(null);

  const [rulesValidation, setRulesValidation] = useState<"default" | "error">("default");
  const [rulesErrorMsg, setRulesErrorMsg] = useState<string | null>(null);

  const { callback: debouncedChange, isPending: isSaving } = useDebouncedCallback(onChange, 300);

  useEffect(() => {
    // Handle profile prop changes
    if (profile.id !== localProfile.id) {
      // Complete profile switch - reset everything to new profile
      setLocalProfile(profile);
      setNameValidation("default");
      setNameErrorMsg(null);
      setTargetsValidation("default");
      setTargetsErrorMsg(null);
      setRulesValidation("default");
      setRulesErrorMsg(null);
    } else if (profile.customRules !== localProfile.customRules) {
      // Custom rules changed externally (e.g., via "Select Custom Rules..." button)
      // Merge with local state to preserve any pending changes
      setLocalProfile({ ...localProfile, customRules: profile.customRules });
    }

    const parsedSources: string[] = [];
    const parsedTargets: string[] = [];

    if (profile.labelSelector) {
      const matches = profile.labelSelector.match(/konveyor\.io\/(source|target)=([^\s|)]+)/g);
      matches?.forEach((match) => {
        const [, type, value] = match.match(/konveyor\.io\/(source|target)=(.+)/) ?? [];
        if (type === "source") {
          parsedSources.push(value);
        } else if (type === "target") {
          parsedTargets.push(value);
        }
      });
    }

    setSelectedSources(parsedSources);
    setSelectedTargets(parsedTargets);

    // Validate targets when profile changes
    validateTargets(parsedTargets);
  }, [profile]);

  // Validate rules whenever useDefaultRules or customRules changes in local state
  // This ensures validation is based on the actual UI state, not stale prop data
  useEffect(() => {
    validateRules(localProfile);
  }, [localProfile.useDefaultRules, localProfile.customRules]);

  const handleInputChange = (value: string, field: keyof AnalysisProfile) => {
    const processedValue = field === "name" ? value.slice(0, MAX_PROFILE_NAME_LENGTH) : value;
    const updated = { ...localProfile, [field]: processedValue };
    setLocalProfile(updated);
  };

  // Validates profile name and updates validation state
  const validateName = (profileToCheck: AnalysisProfile): boolean => {
    const trimmedName = profileToCheck.name.trim();
    const isDuplicate =
      trimmedName !== profile.name && allProfiles.some((p) => p.name === trimmedName);
    const isEmpty = trimmedName === "";

    if (isEmpty) {
      setNameValidation("error");
      setNameErrorMsg("Profile name is required.");
      return false;
    }

    if (isDuplicate) {
      setNameValidation("error");
      setNameErrorMsg("A profile with this name already exists.");
      return false;
    }

    setNameValidation("default");
    setNameErrorMsg(null);
    return true;
  };

  // Checks name validity without updating state (for canSaveProfile)
  const isNameValid = (profileToCheck: AnalysisProfile): boolean => {
    const trimmedName = profileToCheck.name.trim();
    const isDuplicate =
      trimmedName !== profile.name && allProfiles.some((p) => p.name === trimmedName);
    const isEmpty = trimmedName === "";
    return !isEmpty && !isDuplicate;
  };

  const handleBlur = () => {
    if (validateName(localProfile)) {
      debouncedChange({ ...localProfile, name: localProfile.name.trim() });
    }
  };

  const validateTargets = (targets: string[]) => {
    if (targets.length === 0) {
      setTargetsValidation("error");
      setTargetsErrorMsg("At least one target technology is required.");
      return false;
    }
    setTargetsValidation("default");
    setTargetsErrorMsg(null);
    return true;
  };

  const validateRules = (profile: AnalysisProfile) => {
    const hasDefaultRules = profile.useDefaultRules;
    const hasCustomRules = (profile.customRules?.length ?? 0) > 0;

    if (!hasDefaultRules && !hasCustomRules) {
      setRulesValidation("error");
      setRulesErrorMsg("Enable default rules or add custom rules.");
      return false;
    }
    setRulesValidation("default");
    setRulesErrorMsg(null);
    return true;
  };

  // Helper to check if a profile can be saved (all validation passes)
  const canSaveProfile = (profileToCheck: AnalysisProfile, targets: string[]): boolean => {
    const hasValidName = isNameValid(profileToCheck);
    const hasTargets = targets.length > 0;
    const hasRules =
      profileToCheck.useDefaultRules || (profileToCheck.customRules?.length ?? 0) > 0;
    return hasValidName && hasTargets && hasRules;
  };

  // Validates and optionally saves if valid
  const validateAndSave = (updatedProfile: AnalysisProfile, targets: string[]) => {
    const isProfileNameValid = isNameValid(updatedProfile);
    const isTargetsValid = validateTargets(targets);
    const isRulesValid = validateRules(updatedProfile);

    if (isProfileNameValid && isTargetsValid && isRulesValid) {
      debouncedChange(updatedProfile);
    }
  };

  const updateLabelSelector = (sources: string[], targets: string[]) => {
    const selector = buildLabelSelector(sources, targets);
    const updatedProfile = { ...localProfile, labelSelector: selector };
    setLocalProfile(updatedProfile);
    validateAndSave(updatedProfile, targets);
  };

  const handleDefaultRulesChange = (_e: React.FormEvent, checked: boolean) => {
    const updated = { ...localProfile, useDefaultRules: checked };
    setLocalProfile(updated);
    if (canSaveProfile(updated, selectedTargets)) {
      debouncedChange(updated);
    }
  };

  const handleRemoveCustomRule = (index: number) => {
    if (profile.readOnly || isDisabled) {
      return;
    }
    const updatedRules = localProfile.customRules.filter((_, i) => i !== index);
    const newProfile = { ...localProfile, customRules: updatedRules };
    setLocalProfile(newProfile);
    if (canSaveProfile(newProfile, selectedTargets)) {
      debouncedChange(newProfile);
    }
  };

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  return (
    <Form isWidthLimited>
      {/* Operation in Progress Warning */}
      {isDisabled && (
        <Alert
          variant="warning"
          title="Profile editing is temporarily disabled"
          isInline
          style={{ marginBottom: "1rem" }}
        >
          Profile modifications are blocked while analysis or solution generation is in progress.
          Please wait for the current operation to complete.
        </Alert>
      )}

      {/* Active Profile Header */}
      {isActive && !isDisabled && (
        <Alert
          variant="info"
          title={
            <Flex alignItems={{ default: "alignItemsCenter" }}>
              <FlexItem>
                <Icon>
                  <StarIcon color="var(--pf-v5-global--info-color--100)" />
                </Icon>
              </FlexItem>
              <FlexItem>Active Profile</FlexItem>
            </Flex>
          }
          isInline
          style={{ marginBottom: "1rem" }}
        >
          This is your active analysis profile. It will be used for all new analyses. Changes are
          saved automatically, no action needed.
        </Alert>
      )}

      {/* Auto-save Status */}
      <Flex
        justifyContent={{ default: "justifyContentSpaceBetween" }}
        alignItems={{ default: "alignItemsCenter" }}
        style={{ marginBottom: "1rem" }}
      >
        <FlexItem>
          <Title headingLevel="h3" size="lg">
            Profile Settings
          </Title>
        </FlexItem>
        <FlexItem>
          <Flex alignItems={{ default: "alignItemsCenter" }}>
            <FlexItem>
              <Icon>
                {nameValidation === "error" ||
                targetsValidation === "error" ||
                rulesValidation === "error" ? (
                  <ExclamationTriangleIcon color="var(--pf-v5-global--warning-color--100)" />
                ) : (
                  <CheckCircleIcon color="var(--pf-v5-global--success-color--100)" />
                )}
              </Icon>
            </FlexItem>
            <FlexItem>
              <span style={{ fontSize: "0.875rem", color: "var(--pf-v5-global--Color--200)" }}>
                {nameValidation === "error" ||
                targetsValidation === "error" ||
                rulesValidation === "error"
                  ? "Fix errors to save"
                  : isSaving
                    ? "Saving..."
                    : "Changes saved automatically"}
              </span>
            </FlexItem>
          </Flex>
        </FlexItem>
      </Flex>

      {(nameValidation === "error" ||
        targetsValidation === "error" ||
        rulesValidation === "error") && (
        <FormAlert>
          <Alert
            variant="danger"
            title="Fix validation errors before continuing."
            isInline
            aria-live="polite"
          />
        </FormAlert>
      )}

      <FormGroup label="Profile Name" fieldId="profile-name" isRequired>
        <TextInput
          id="profile-name"
          isDisabled={profile.readOnly || isDisabled}
          value={localProfile.name}
          onChange={(_e, value) => handleInputChange(value, "name")}
          onBlur={handleBlur}
          validated={nameValidation}
          maxLength={MAX_PROFILE_NAME_LENGTH}
        />
        {nameErrorMsg ? (
          <FormHelperText>
            <HelperText>
              <HelperTextItem icon={<ExclamationCircleIcon />} variant="error">
                {nameErrorMsg}
              </HelperTextItem>
            </HelperText>
          </FormHelperText>
        ) : (
          <FormHelperText>
            <HelperText>
              <HelperTextItem>
                {localProfile.name.length}/{MAX_PROFILE_NAME_LENGTH} characters
              </HelperTextItem>
            </HelperText>
          </FormHelperText>
        )}
      </FormGroup>

      <FormGroup label="Target Technologies" fieldId="targets" isRequired>
        <CreatableMultiSelectField
          fieldId="targets"
          value={selectedTargets}
          onChange={(updated) => {
            setSelectedTargets(updated);
            updateLabelSelector(selectedSources, updated);
          }}
          initialOptions={targetOptions}
          isDisabled={isDisabled}
        />
        {targetsErrorMsg ? (
          <FormHelperText>
            <HelperText>
              <HelperTextItem icon={<ExclamationCircleIcon />} variant="error">
                {targetsErrorMsg}
              </HelperTextItem>
            </HelperText>
          </FormHelperText>
        ) : (
          <FormHelperText>
            <HelperText>
              <HelperTextItem icon={<InfoCircleIcon />}>
                Technologies you want to migrate to (e.g., Spring Boot, Quarkus)
              </HelperTextItem>
            </HelperText>
          </FormHelperText>
        )}
      </FormGroup>

      <FormGroup label="Source Technologies" fieldId="sources">
        <CreatableMultiSelectField
          fieldId="sources"
          value={selectedSources}
          onChange={(updated) => {
            setSelectedSources(updated);
            updateLabelSelector(updated, selectedTargets);
          }}
          initialOptions={sourceOptions}
          isDisabled={isDisabled}
        />
        <FormHelperText>
          <HelperText>
            <HelperTextItem icon={<InfoCircleIcon />}>
              Technologies you&apos;re migrating from (e.g., Java EE, WebLogic)
            </HelperTextItem>
          </HelperText>
        </FormHelperText>
      </FormGroup>

      <FormGroup label="Use Default Rules" fieldId="use-default-rules">
        <Switch
          id="use-default-rules"
          isChecked={localProfile.useDefaultRules}
          isDisabled={profile.readOnly || isDisabled}
          onChange={handleDefaultRulesChange}
        />
        {rulesErrorMsg ? (
          <FormHelperText>
            <HelperText>
              <HelperTextItem icon={<ExclamationCircleIcon />} variant="error">
                {rulesErrorMsg}
              </HelperTextItem>
            </HelperText>
          </FormHelperText>
        ) : (
          <FormHelperText>
            <HelperText>
              <HelperTextItem icon={<InfoCircleIcon />}>
                Include {getBrandName()}&apos;s built-in migration rules
              </HelperTextItem>
            </HelperText>
          </FormHelperText>
        )}
      </FormGroup>

      <FormGroup label="Custom Rules" fieldId="custom-rules">
        <Stack hasGutter>
          <StackItem isFilled>
            {isWebEnvironment ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".yaml,.yml"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const files = e.target.files;
                    if (!files || files.length === 0) {
                      return;
                    }

                    const filePromises = Array.from(files).map((file) => {
                      return new Promise<{ name: string; content: string }>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                          resolve({
                            name: file.name,
                            content: reader.result as string,
                          });
                        };
                        reader.onerror = () => reject(reader.error);
                        reader.readAsText(file);
                      });
                    });

                    Promise.all(filePromises)
                      .then((uploadedFiles) => {
                        dispatch({
                          type: UPLOAD_CUSTOM_RULES,
                          payload: {
                            profileId: profile.id,
                            files: uploadedFiles,
                          },
                        });
                      })
                      .catch((err) => {
                        console.error("Failed to read files:", err);
                      });

                    e.target.value = "";
                  }}
                />
                <Button
                  variant="secondary"
                  isDisabled={profile.readOnly || isDisabled}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload Custom Rules…
                </Button>
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem icon={<InfoCircleIcon />}>
                      Upload YAML rule files from your local computer
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  isDisabled={profile.readOnly || isDisabled}
                  onClick={() =>
                    dispatch({
                      type: CONFIGURE_CUSTOM_RULES,
                      payload: { profileId: profile.id },
                    })
                  }
                >
                  Select Custom Rules…
                </Button>
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem icon={<InfoCircleIcon />}>
                      Add your own custom migration rules
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </>
            )}
          </StackItem>
          <StackItem>
            <LabelGroup aria-label="Custom Rules">
              {localProfile.customRules?.map((path, index) => (
                <Label
                  key={index}
                  color="blue"
                  icon={
                    <Tooltip content={path}>
                      <span>📄</span>
                    </Tooltip>
                  }
                  closeBtnAriaLabel="Remove rule"
                  onClose={
                    profile.readOnly || isDisabled ? undefined : () => handleRemoveCustomRule(index)
                  }
                >
                  {truncateMiddle(path.split("/").pop() || path, 30)}
                </Label>
              ))}
            </LabelGroup>
          </StackItem>
        </Stack>
      </FormGroup>

      <Flex spaceItems={{ default: "spaceItemsMd" }}>
        <FlexItem>
          {isActive ? (
            <Tooltip content="This profile is already active and will be used for analyses">
              <Button variant="secondary" isDisabled={true} icon={<StarIcon />}>
                Active Profile
              </Button>
            </Tooltip>
          ) : (
            <Tooltip content="Set this profile as active to use it for new analyses">
              <Button
                variant="secondary"
                onClick={() => onMakeActive(profile.id)}
                isDisabled={isDisabled}
              >
                Make Active
              </Button>
            </Tooltip>
          )}
        </FlexItem>
        <FlexItem>
          <Button
            variant="danger"
            onClick={() => setIsDeleteDialogOpen(true)}
            isDisabled={profile.readOnly || isDisabled}
          >
            Delete Profile
          </Button>
        </FlexItem>
      </Flex>

      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        title="Delete profile?"
        message={`Are you sure you want to delete the profile "${profile.name}"? This action cannot be undone.`}
        confirmButtonText="Delete"
        onConfirm={() => {
          setIsDeleteDialogOpen(false);
          onDelete(profile.id);
        }}
        onCancel={() => setIsDeleteDialogOpen(false)}
      />
    </Form>
  );
};

function truncateMiddle(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }
  const half = Math.floor(maxLength / 2);
  return `${text.slice(0, half)}…${text.slice(-half)}`;
}
