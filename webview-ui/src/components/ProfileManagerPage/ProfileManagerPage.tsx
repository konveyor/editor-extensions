import React, { useState } from "react";
import {
  Page,
  PageSection,
  Split,
  SplitItem,
  Bullseye,
  DataList,
  DataListItem,
  DataListItemRow,
  DataListItemCells,
  DataListCell,
  Button,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  TextInput,
  Switch,
  DataListAction,
  Dropdown,
  DropdownList,
  DropdownItem,
  MenuToggle,
  MenuToggleElement,
  FormSelect,
  FormSelectOption,
  Content,
  ContentVariants,
} from "@patternfly/react-core";
import EllipsisVIcon from "@patternfly/react-icons/dist/esm/icons/ellipsis-v-icon";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";

const ProfileList: React.FC<{
  profiles: any[];
  selected: string | null;
  active: string | null;
  onSelect: (name: string) => void;
  onCreate: () => void;
}> = ({ profiles, selected, active, onSelect, onCreate }) => {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  return (
    <>
      <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }}>
        <FlexItem>
          <Button variant="primary" onClick={onCreate} isBlock>
            + New Profile
          </Button>
        </FlexItem>
        <FlexItem>
          <DataList aria-label="Profile list">
            {profiles.map((profile) => (
              <DataListItem key={profile.name} aria-labelledby={`profile-${profile.name}`}>
                <DataListItemRow>
                  <DataListItemCells
                    dataListCells={[
                      <DataListCell key="name">
                        <span
                          id={`profile-${profile.name}`}
                          style={{ fontWeight: selected === profile.name ? "bold" : undefined }}
                        >
                          {profile.name} {profile.name === active && <em>(active)</em>}
                        </span>
                      </DataListCell>,
                    ]}
                  />
                  <DataListAction
                    aria-labelledby={`profile-${profile.name}`}
                    id={`actions-${profile.name}`}
                    aria-label="Actions"
                  >
                    <Dropdown
                      popperProps={{ position: "right" }}
                      onSelect={() => setOpenDropdown(null)}
                      toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
                        <MenuToggle
                          ref={toggleRef}
                          isExpanded={openDropdown === profile.name}
                          onClick={() =>
                            setOpenDropdown(openDropdown === profile.name ? null : profile.name)
                          }
                          variant="plain"
                          aria-label={`Actions for ${profile.name}`}
                          icon={<EllipsisVIcon />}
                        />
                      )}
                      isOpen={openDropdown === profile.name}
                      onOpenChange={(isOpen: boolean) =>
                        setOpenDropdown(isOpen ? profile.name : null)
                      }
                    >
                      <DropdownList>
                        <DropdownItem onClick={() => onSelect(profile.name)}>Edit</DropdownItem>
                        {/* Add more profile-level actions here if needed */}
                      </DropdownList>
                    </Dropdown>
                  </DataListAction>
                </DataListItemRow>
              </DataListItem>
            ))}
          </DataList>
        </FlexItem>
      </Flex>
    </>
  );
};

const ProfileEditorForm: React.FC<{
  profile: any;
  isActive: boolean;
  onChange: (profile: any) => void;
  onDelete: () => void;
  onMakeActive: (name: string) => void;
}> = ({ profile, isActive, onChange, onDelete, onMakeActive }) => {
  const handleInputChange = (value: string, field: string) => {
    onChange({ ...profile, [field]: value });
  };

  const handleSwitchChange = (value: boolean, field: string) => {
    onChange({ ...profile, [field]: value });
  };

  return (
    <Form isWidthLimited>
      <FormGroup label="Profile Name" fieldId="profile-name">
        <TextInput
          id="profile-name"
          value={profile.name}
          onChange={(_e, value) => handleInputChange(value, "name")}
        />
      </FormGroup>

      <FormGroup label="Label Selector" fieldId="label-selector">
        <TextInput
          id="label-selector"
          value={profile.labelSelector}
          onChange={(_e, value) => handleInputChange(value, "labelSelector")}
        />
      </FormGroup>

      <FormGroup label="Use Default Rules" fieldId="use-default-rules">
        <Switch
          id="use-default-rules"
          isChecked={profile.useDefaultRules}
          onChange={(_e, checked) => handleSwitchChange(checked, "useDefaultRules")}
        />
      </FormGroup>

      <FormGroup label="Mode" fieldId="mode">
        <FormSelect
          id="mode"
          value={profile.mode}
          onChange={(_e, value) => handleInputChange(value, "mode")}
        >
          <FormSelectOption value="source-only" label="Source Only" />
          <FormSelectOption value="full-analysis" label="Full Analysis" />
        </FormSelect>
      </FormGroup>

      <Flex spaceItems={{ default: "spaceItemsMd" }}>
        <FlexItem>
          <Button
            variant="secondary"
            onClick={() => onMakeActive(profile.name)}
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

export const ProfileManagerPage: React.FC = () => {
  const { state, dispatch } = useExtensionStateContext();
  const { profiles, activeProfileName } = state;

  const [selectedProfileName, setSelectedProfileName] = useState(
    activeProfileName || profiles[0]?.name,
  );
  const selectedProfile = profiles?.find((p) => p.name === selectedProfileName);

  const handleProfileChange = (updatedProfile) => {
    dispatch({
      type: "UPDATE_PROFILE",
      payload: {
        originalName: selectedProfileName,
        updatedProfile: updatedProfile,
      },
    });
    if (updatedProfile.name !== selectedProfileName) {
      setSelectedProfileName(updatedProfile.name);
    }
  };

  const handleCreateProfile = () => {
    const baseName = "New Profile";
    let index = 1;
    let newName = baseName;
    while (profiles.find((p) => p.name === newName)) {
      newName = `${baseName} ${index++}`;
    }
    const newProfile = {
      name: newName,
      mode: "source-only",
      customRules: [],
      useDefaultRules: true,
      labelSelector: "",
    };
    dispatch({ type: "ADD_PROFILE", payload: newProfile });
    // window.vscode.postMessage({ type: "ADD_PROFILE", payload: newProfile });
    setSelectedProfileName(newProfile.name);
  };

  const handleDeleteProfile = () => {
    if (selectedProfileName) {
      window.vscode.postMessage({ type: "DELETE_PROFILE", payload: selectedProfileName });
      setSelectedProfileName("");
    }
  };

  const handleMakeActive = (name: string) => {
    dispatch({ type: "SET_ACTIVE_PROFILE", payload: name });
    window.vscode.postMessage({ type: "SET_ACTIVE_PROFILE", payload: name });
  };

  return (
    <Page>
      <PageSection isFilled>
        <Split hasGutter>
          <SplitItem isFilled style={{ width: "300px", flex: "0 0 300px" }}>
            <ProfileList
              profiles={profiles}
              selected={selectedProfileName}
              active={activeProfileName}
              onSelect={setSelectedProfileName}
              onCreate={handleCreateProfile}
            />
          </SplitItem>
          <SplitItem isFilled style={{ flex: "1 1 auto" }}>
            {selectedProfile ? (
              <ProfileEditorForm
                profile={selectedProfile}
                isActive={selectedProfile.name === activeProfileName}
                onChange={handleProfileChange}
                onDelete={handleDeleteProfile}
                onMakeActive={handleMakeActive}
              />
            ) : (
              <Bullseye>
                <Content component={ContentVariants.p}>Select or create a profile</Content>
              </Bullseye>
            )}
          </SplitItem>
        </Split>
      </PageSection>
    </Page>
  );
};
