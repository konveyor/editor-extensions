import React from "react";
import {
  Select,
  SelectList,
  SelectOption,
  MenuToggle,
  MenuToggleElement,
} from "@patternfly/react-core";

import { useExtensionStateContext } from "src/context/ExtensionStateContext";

interface Profile {
  name: string;
}

interface ProfileSelectorProps {
  profiles: Profile[];
  activeProfile: string;
  onChange: (newProfile: string) => void;
  isDisabled?: boolean;
}

export const ProfileSelector: React.FC<ProfileSelectorProps> = ({
  profiles,
  activeProfile,
  onChange,
  isDisabled = false,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const { state, dispatch } = useExtensionStateContext();

  const onToggleClick = () => {
    setIsOpen((prev) => !prev);
  };

  const onSelect = (_event: React.MouseEvent, value: string | number | undefined) => {
    const selectedProfile = value as string;
    setIsOpen(false);
    onChange(selectedProfile);
  };

  const toggle = (toggleRef: React.Ref<MenuToggleElement>) => (
    <MenuToggle
      ref={toggleRef}
      onClick={onToggleClick}
      isExpanded={isOpen}
      isDisabled={isDisabled}
      style={{ width: "200px" }}
    >
      {activeProfile || "Select a profile"}
    </MenuToggle>
  );

  return (
    <Select
      id="profile-selector"
      isOpen={isOpen}
      selected={activeProfile}
      onSelect={onSelect}
      onOpenChange={setIsOpen}
      toggle={toggle}
      shouldFocusToggleOnSelect
    >
      <SelectList>
        {profiles.length > 0 ? (
          profiles.map((profile) => (
            <SelectOption key={profile.name} value={profile.name}>
              {profile.name}
            </SelectOption>
          ))
        ) : (
          <SelectOption isDisabled key="no-profiles" value="No profiles">
            No profiles found
          </SelectOption>
        )}
      </SelectList>
    </Select>
  );
};
