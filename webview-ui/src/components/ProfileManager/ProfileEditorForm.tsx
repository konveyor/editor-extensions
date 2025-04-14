import React, { useEffect, useRef, useState } from "react";
import {
  Button,
  Form,
  FormGroup,
  TextInput,
  Switch,
  Flex,
  FlexItem,
  FormSelect,
  FormSelectOption,
  FormHelperText,
  HelperText,
  HelperTextItem,
} from "@patternfly/react-core";
import { AnalysisMode, AnalysisProfile } from "../../../../shared/dist/types";
import { ExclamationCircleIcon } from "@patternfly/react-icons";

function useDebouncedCallback(callback: (...args: any[]) => void, delay: number) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  return (...args: any[]) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      callback(...args);
    }, delay);
  };
}

export const ProfileEditorForm: React.FC<{
  profile: AnalysisProfile;
  isActive: boolean;
  onChange: (profile: any) => void;
  onDelete: () => void;
  onMakeActive: (name: string) => void;
  allProfiles: AnalysisProfile[];
  originalName: string;
}> = ({ profile, isActive, onChange, onDelete, onMakeActive, allProfiles, originalName }) => {
  const [localProfile, setLocalProfile] = useState(profile);
  const [nameError, setNameError] = useState<string | null>(null);

  // Sync form if parent profile changes
  useEffect(() => {
    setLocalProfile(profile);
  }, [profile]);

  const debouncedChange = useDebouncedCallback(onChange, 300);

  const handleBlur = () => {
    const isDupelicate =
      localProfile.name !== originalName && allProfiles.some((p) => p.name === localProfile.name);
    if (isDupelicate) {
      setNameError("Profile name already exists");
      return;
    }
    setNameError(null);
    debouncedChange(localProfile);
  };
  return (
    <Form isWidthLimited>
      <FormGroup
        label="Profile Name"
        fieldId="profile-name"
        // validated={nameError ? "error" : "default"}

        // helperTextInvalid={nameError}
      >
        <TextInput
          id="profile-name"
          value={localProfile.name}
          onChange={(_e, value) => setLocalProfile((prev) => ({ ...prev, name: value }))}
          onBlur={handleBlur}
          validated={nameError ? "error" : "default"}
        />
        <FormHelperText>
          <HelperText>
            <HelperTextItem
              icon={<ExclamationCircleIcon />}
              variant={nameError ? "error" : "default"}
            >
              {nameError ? nameError : "Name of the profile"}
            </HelperTextItem>
          </HelperText>
        </FormHelperText>
      </FormGroup>

      <FormGroup label="Label Selector" fieldId="label-selector">
        <TextInput
          id="label-selector"
          value={localProfile.labelSelector}
          onChange={(_e, value) => setLocalProfile((prev) => ({ ...prev, labelSelector: value }))}
          onBlur={handleBlur}
        />
      </FormGroup>

      <FormGroup label="Use Default Rules" fieldId="use-default-rules">
        <Switch
          id="use-default-rules"
          isChecked={localProfile.useDefaultRules}
          onChange={(_e, checked) => {
            const updated = { ...localProfile, useDefaultRules: checked };
            setLocalProfile(updated);
            debouncedChange(updated);
          }}
        />
      </FormGroup>

      <FormGroup label="Mode" fieldId="mode">
        <FormSelect
          id="mode"
          value={localProfile.mode}
          onChange={(_e, value) => {
            const updated = { ...localProfile, mode: value as AnalysisMode };
            setLocalProfile(updated);
            debouncedChange(updated);
          }}
        >
          <FormSelectOption value="source-only" label="Source Only" />
          <FormSelectOption value="full-analysis" label="Full Analysis" />
        </FormSelect>
      </FormGroup>

      <Flex spaceItems={{ default: "spaceItemsMd" }}>
        <FlexItem>
          <Button
            variant="secondary"
            onClick={() => onMakeActive(localProfile.name)}
            isDisabled={isActive}
          >
            Make Active
          </Button>
        </FlexItem>
        <FlexItem>
          <Button variant="danger" onClick={onDelete}>
            Delete Profile
          </Button>
        </FlexItem>
      </Flex>
    </Form>
  );
};
