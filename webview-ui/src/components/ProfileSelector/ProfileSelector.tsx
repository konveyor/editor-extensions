import React from "react";
import {
  Select,
  SelectList,
  SelectOption,
  MenuToggle,
  MenuToggleElement,
} from "@patternfly/react-core";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";
import { AnalysisProfile } from "../../../../shared/dist/types";

interface ProfileSelectorProps {
  profiles: AnalysisProfile[];
  activeProfile: string;
  onChange: (newProfileId: string) => void;
  isDisabled?: boolean;
}

export const ProfileSelector: React.FC<ProfileSelectorProps> = ({
  profiles,
  activeProfile,
  onChange,
  isDisabled = false,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);

  const onToggleClick = () => setIsOpen((prev) => !prev);

  const onSelect = (_event?: React.MouseEvent<Element>, value?: string | number) => {
    if (typeof value === "string") {
      onChange(value);
      setIsOpen(false);
    }
  };

  const selected = profiles.find((p) => p.id === activeProfile);

  const toggle = (toggleRef: React.Ref<MenuToggleElement>) => (
    <MenuToggle
      ref={toggleRef}
      onClick={onToggleClick}
      isExpanded={isOpen}
      isDisabled={isDisabled}
      style={{ width: "200px" }}
    >
      {selected?.name ?? "Select a profile"}
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
            <SelectOption key={profile.id} value={profile.id}>
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
