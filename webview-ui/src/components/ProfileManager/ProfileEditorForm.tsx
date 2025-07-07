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
  CheckCircleIcon,
  StarIcon,
  InfoCircleIcon,
} from "@patternfly/react-icons";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";
import { AnalysisProfile, CONFIGURE_CUSTOM_RULES } from "@editor-extensions/shared";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { CreatableMultiSelectField } from "./CreatableMultiSelectField";
import { buildLabelSelector } from "@editor-extensions/shared";

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
}> = ({ profile, isActive, onChange, onDelete, onMakeActive, allProfiles }) => {
  const [localProfile, setLocalProfile] = useState(profile);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);

  const [nameValidation, setNameValidation] = useState<"default" | "error">("default");
  const [nameErrorMsg, setNameErrorMsg] = useState<string | null>(null);

  const { dispatch } = useExtensionStateContext();

  const { callback: debouncedChange, isPending: isSaving } = useDebouncedCallback(onChange, 300);

  useEffect(() => {
    setLocalProfile(profile);
    setNameValidation("default");
    setNameErrorMsg(null);

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
  }, [profile]);

  const handleInputChange = (value: string, field: keyof AnalysisProfile) => {
    const updated = { ...localProfile, [field]: value };
    setLocalProfile(updated);
  };

  const handleBlur = () => {
    const trimmedName = localProfile.name.trim();

    const isDuplicate =
      trimmedName !== profile.name && allProfiles.some((p) => p.name === trimmedName);
    const isEmpty = trimmedName === "";

    if (isEmpty) {
      setNameValidation("error");
      setNameErrorMsg("Profile name is required.");
      return;
    }

    if (isDuplicate) {
      setNameValidation("error");
      setNameErrorMsg("A profile with this name already exists.");
      return;
    }

    setNameValidation("default");
    setNameErrorMsg(null);
    debouncedChange({ ...localProfile, name: trimmedName });
  };

  const updateLabelSelector = (sources: string[], targets: string[]) => {
    const selector = buildLabelSelector(sources, targets);
    const updatedProfile = { ...localProfile, labelSelector: selector };
    setLocalProfile(updatedProfile);
    debouncedChange(updatedProfile);
  };

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  return (
    <Form isWidthLimited>
      {/* Active Profile Header */}
      {isActive && (
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
                <CheckCircleIcon color="var(--pf-v5-global--success-color--100)" />
              </Icon>
            </FlexItem>
            <FlexItem>
              <span style={{ fontSize: "0.875rem", color: "var(--pf-v5-global--Color--200)" }}>
                {isSaving ? "Saving..." : "Changes saved automatically"}
              </span>
            </FlexItem>
          </Flex>
        </FlexItem>
      </Flex>

      {nameValidation === "error" && (
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
          isDisabled={profile.readOnly}
          value={localProfile.name}
          onChange={(_e, value) => handleInputChange(value, "name")}
          onBlur={handleBlur}
          validated={nameValidation}
        />
        {nameErrorMsg && (
          <FormHelperText>
            <HelperText>
              <HelperTextItem icon={<ExclamationCircleIcon />} variant="error">
                {nameErrorMsg}
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
        />
        <FormHelperText>
          <HelperText>
            <HelperTextItem icon={<InfoCircleIcon />}>
              Technologies you want to migrate to (e.g., Spring Boot, Quarkus)
            </HelperTextItem>
          </HelperText>
        </FormHelperText>
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
          isDisabled={profile.readOnly}
          onChange={(_e, checked) => {
            const updated = { ...localProfile, useDefaultRules: checked };
            setLocalProfile(updated);
            debouncedChange(updated);
          }}
        />
        <FormHelperText>
          <HelperText>
            <HelperTextItem icon={<InfoCircleIcon />}>
              Include Konveyor&apos;s built-in migration rules
            </HelperTextItem>
          </HelperText>
        </FormHelperText>
      </FormGroup>

      <FormGroup label="Custom Rules" fieldId="custom-rules">
        <Stack hasGutter>
          <StackItem isFilled>
            <Button
              variant="secondary"
              isDisabled={profile.readOnly}
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
                  onClose={() => {
                    const updated = localProfile.customRules.filter((_, i) => i !== index);
                    const newProfile = { ...localProfile, customRules: updated };
                    setLocalProfile(newProfile);
                    debouncedChange(newProfile);
                  }}
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
              <Button variant="secondary" onClick={() => onMakeActive(profile.id)}>
                Make Active
              </Button>
            </Tooltip>
          )}
        </FlexItem>
        <FlexItem>
          <Button
            variant="danger"
            onClick={() => setIsDeleteDialogOpen(true)}
            isDisabled={profile.readOnly}
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
