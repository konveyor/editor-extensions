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
  FormAlert,
  Alert,
} from "@patternfly/react-core";
import { AnalysisMode, AnalysisProfile } from "../../../../shared/dist/types";
import { ExclamationCircleIcon } from "@patternfly/react-icons";

function useDebouncedCallback(callback: (...args: any[]) => void, delay: number) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  return (...args: any[]) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => callback(...args), delay);
  };
}

export const ProfileEditorForm: React.FC<{
  profile: AnalysisProfile;
  isActive: boolean;
  onChange: (profile: AnalysisProfile) => void;
  onDelete: () => void;
  onMakeActive: (id: string) => void;
  allProfiles: AnalysisProfile[];
}> = ({ profile, isActive, onChange, onDelete, onMakeActive, allProfiles }) => {
  const [localProfile, setLocalProfile] = useState(profile);
  const [nameValidation, setNameValidation] = useState<"default" | "error">("default");
  const [nameErrorMsg, setNameErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setLocalProfile(profile);
    setNameValidation("default");
    setNameErrorMsg(null);
  }, [profile]);

  const debouncedChange = useDebouncedCallback(onChange, 300);

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

  return (
    <Form isWidthLimited>
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

      <FormGroup label="Label Selector" fieldId="label-selector">
        <TextInput
          id="label-selector"
          value={localProfile.labelSelector}
          onChange={(_e, value) => handleInputChange(value, "labelSelector")}
          onBlur={() => debouncedChange(localProfile)}
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
            onClick={() => onMakeActive(profile.id)}
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
