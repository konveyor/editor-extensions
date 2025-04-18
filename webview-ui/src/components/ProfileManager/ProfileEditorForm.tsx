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
  FormSelect,
  FormSelectOption,
  FormHelperText,
  HelperText,
  HelperTextItem,
  FormAlert,
  Alert,
  MenuToggle,
  Select,
  SelectList,
  SelectOption,
} from "@patternfly/react-core";
import { ExclamationCircleIcon } from "@patternfly/react-icons";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";
import { AnalysisProfile, AnalysisMode, CONFIGURE_CUSTOM_RULES } from "@editor-extensions/shared";

function useDebouncedCallback(callback: (...args: any[]) => void, delay: number) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  return (...args: any[]) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
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
  const [sourceOpen, setSourceOpen] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);

  const [nameValidation, setNameValidation] = useState<"default" | "error">("default");
  const [nameErrorMsg, setNameErrorMsg] = useState<string | null>(null);

  const { dispatch, state } = useExtensionStateContext();

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

  const handleSourceToggle = () => setSourceOpen((prev) => !prev);
  const handleTargetToggle = () => setTargetOpen((prev) => !prev);

  const handleSourcesChange = (selection: string) => {
    const updated = toggleSelection(selectedSources, selection);
    setSelectedSources(updated);
    updateLabelSelector(updated, selectedTargets);
  };

  const handleTargetsChange = (selection: string) => {
    const updated = toggleSelection(selectedTargets, selection);
    setSelectedTargets(updated);
    updateLabelSelector(selectedSources, updated);
  };

  const updateLabelSelector = (sources: string[], targets: string[]) => {
    const selector = buildLabelSelector(sources, targets);
    const updatedProfile = { ...localProfile, labelSelector: selector };
    setLocalProfile(updatedProfile);
    debouncedChange(updatedProfile);
  };

  const toggleSelection = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

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

      {/* <FormGroup label="Label Selector" fieldId="label-selector">
        <TextInput
          id="label-selector"
          isDisabled={profile.readOnly}
          value={localProfile.labelSelector}
          onChange={(_e, value) => handleInputChange(value, "labelSelector")}
          onBlur={() => debouncedChange(localProfile)}
        />
      </FormGroup> */}
      <FormGroup label="Target Technologies" fieldId="targets">
        <Select
          isOpen={targetOpen}
          onOpenChange={setTargetOpen}
          onSelect={(_ev, value) => handleTargetsChange(value as string)}
          toggle={(ref) => (
            <MenuToggle
              ref={ref}
              isDisabled={profile.readOnly}
              onClick={handleTargetToggle}
              isExpanded={targetOpen}
            >
              {selectedTargets.length ? selectedTargets.join(", ") : "Select targets"}
            </MenuToggle>
          )}
          selected={selectedTargets}
        >
          <SelectList>
            {targetOptions.map((opt) => (
              <SelectOption key={opt} value={opt}>
                {opt}
              </SelectOption>
            ))}
          </SelectList>
        </Select>
      </FormGroup>

      <FormGroup label="Source Technologies" fieldId="sources">
        <Select
          isOpen={sourceOpen}
          onOpenChange={setSourceOpen}
          onSelect={(_ev, value) => handleSourcesChange(value as string)}
          toggle={(ref) => (
            <MenuToggle
              ref={ref}
              isDisabled={profile.readOnly}
              onClick={handleSourceToggle}
              isExpanded={sourceOpen}
            >
              {selectedSources.length ? selectedSources.join(", ") : "Select sources"}
            </MenuToggle>
          )}
          selected={selectedSources}
        >
          <SelectList>
            {sourceOptions.map((opt) => (
              <SelectOption key={opt} value={opt}>
                {opt}
              </SelectOption>
            ))}
          </SelectList>
        </Select>
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
          isDisabled={profile.readOnly}
        >
          <FormSelectOption value="source-only" label="Source Only" />
          <FormSelectOption value="full-analysis" label="Full Analysis" />
        </FormSelect>
      </FormGroup>
      <FormGroup label="Custom Rules" fieldId="custom-rules">
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
          <Button variant="danger" onClick={onDelete} isDisabled={profile.readOnly}>
            Delete Profile
          </Button>
        </FlexItem>
      </Flex>
    </Form>
  );
};

export function buildLabelSelector(sources: string[], targets: string[]): string {
  const parts: string[] = [];

  if (targets.length) {
    parts.push(...targets.map((t) => `konveyor.io/target=${t}`));
  }

  if (sources.length) {
    parts.push(...sources.map((s) => `konveyor.io/source=${s}`));
  }

  if (!parts.length) {
    return "(discovery)";
  }
  return `(${parts.join(" || ")}) || (discovery)`;
}
