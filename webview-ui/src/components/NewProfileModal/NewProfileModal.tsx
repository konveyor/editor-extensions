import React, { useRef, useState } from "react";
import {
  Button,
  Form,
  FormGroup,
  FormGroupLabelHelp,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalVariant,
  TextInput,
  Popover,
  Select,
  SelectList,
  SelectOption,
  Checkbox,
} from "@patternfly/react-core";

const MAX_PROFILE_NAME_LENGTH = 24;

interface NewProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (profile: {
    name: string;
    mode: string;
    labelSelector: string;
    useDefaultRulesets: boolean;
  }) => void;
}

export const NewProfileModal: React.FC<NewProfileModalProps> = ({ isOpen, onClose, onSave }) => {
  const [name, setName] = useState("");
  const [mode, setMode] = useState("source-only");
  const [labelSelector, setLabelSelector] = useState("");
  const [useDefaultRulesets, setUseDefaultRulesets] = useState(true);
  const [isModeOpen, setIsModeOpen] = useState(false);

  const nameHelpRef = useRef(null);
  const modeHelpRef = useRef(null);
  const labelHelpRef = useRef(null);

  const handleConfirm = () => {
    onSave({ name, mode, labelSelector, useDefaultRulesets });
    onClose();
    // Reset form
    setName("");
    setMode("source-only");
    setLabelSelector("");
    setUseDefaultRulesets(true);
  };

  return (
    <Modal
      variant={ModalVariant.small}
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="create-profile-title"
      aria-describedby="create-profile-description"
    >
      <ModalHeader
        title="Create new profile"
        description="Set up a reusable analysis profile with mode, selectors, and ruleset preferences."
        descriptorId="create-profile-description"
        labelId="create-profile-title"
      />
      <ModalBody>
        <Form id="create-profile-form">
          <FormGroup
            label="Profile Name"
            labelHelp={
              <Popover
                triggerRef={nameHelpRef}
                headerContent="Name"
                bodyContent="This will be used to identify the profile in dropdowns."
              >
                <FormGroupLabelHelp aria-label="label" ref={nameHelpRef} />
              </Popover>
            }
            isRequired
            fieldId="profile-name"
          >
            <TextInput
              id="profile-name"
              value={name}
              onChange={(_, val) => setName(val.slice(0, MAX_PROFILE_NAME_LENGTH))}
              isRequired
              maxLength={MAX_PROFILE_NAME_LENGTH}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  {name.length}/{MAX_PROFILE_NAME_LENGTH} characters
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>

          <FormGroup
            label="Mode"
            labelHelp={
              <Popover
                triggerRef={modeHelpRef}
                headerContent="Mode"
                bodyContent="Controls how the analysis is run (e.g., source-only or source+target)."
              >
                <FormGroupLabelHelp aria-label="label" ref={modeHelpRef} />
              </Popover>
            }
            fieldId="profile-mode"
          >
            <Select
              id="mode"
              toggle={(toggleRef) => (
                <Button ref={toggleRef} onClick={() => setIsModeOpen((prev) => !prev)}>
                  {mode}
                </Button>
              )}
              isOpen={isModeOpen}
              selected={mode}
              onSelect={(_, val) => {
                setMode(val as string);
                setIsModeOpen(false);
              }}
              onOpenChange={setIsModeOpen}
            >
              <SelectList>
                <SelectOption value="source-only">source-only</SelectOption>
                <SelectOption value="source+target">source+target</SelectOption>
              </SelectList>
            </Select>
          </FormGroup>

          <FormGroup
            label="Label Selector"
            labelHelp={
              <Popover
                triggerRef={labelHelpRef}
                headerContent="Label Selector"
                bodyContent="This value limits the scope of the analysis by filtering resources."
              >
                <FormGroupLabelHelp aria-label="label" ref={labelHelpRef} />
              </Popover>
            }
            fieldId="label-selector"
          >
            <TextInput
              id="label-selector"
              value={labelSelector}
              onChange={(_, val) => setLabelSelector(val)}
            />
          </FormGroup>

          <FormGroup fieldId="rulesets-checkbox">
            <Checkbox
              id="rulesets-checkbox"
              label="Use default rulesets"
              isChecked={useDefaultRulesets}
              onChange={(_, val) => setUseDefaultRulesets(val)}
            />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          key="confirm"
          variant="primary"
          form="create-profile-form"
          onClick={handleConfirm}
          isDisabled={!name.trim()}
        >
          Create Profile
        </Button>
        <Button key="cancel" variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};
