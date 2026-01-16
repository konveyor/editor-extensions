import React, { useRef, useState } from "react";
import {
  Dropdown,
  DropdownList,
  DropdownItem,
  MenuToggle,
  MenuToggleElement,
  MenuSearch,
  MenuSearchInput,
  InputGroup,
  InputGroupItem,
  Button,
  ButtonVariant,
  SearchInput,
  Divider,
} from "@patternfly/react-core";
import SearchIcon from "@patternfly/react-icons/dist/esm/icons/search-icon";
import CheckIcon from "@patternfly/react-icons/dist/esm/icons/check-icon";
import LockIcon from "@patternfly/react-icons/dist/esm/icons/lock-icon";
import { AnalysisProfile } from "../../../../shared/dist/types";
import { CogIcon } from "@patternfly/react-icons/dist/esm/icons/cog-icon";

interface ProfileSelectorProps {
  profiles: AnalysisProfile[];
  activeProfile: string | null;
  onChange: (newProfileId: string) => void;
  onManageProfiles: () => void;
  isDisabled?: boolean;
  isInTreeMode?: boolean; // When true, profiles are managed externally (filesystem/hub)
}

export const ProfileSelector: React.FC<ProfileSelectorProps> = ({
  profiles,
  activeProfile,
  onChange,
  onManageProfiles,
  isDisabled = false,
  isInTreeMode = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const toggleRef = useRef<MenuToggleElement>(null);

  const selected = profiles.find((p) => p.id === activeProfile);

  const filtered = searchInput.trim()
    ? profiles.filter((p) => p.name.toLowerCase().includes(searchInput.trim().toLowerCase()))
    : profiles;

  return (
    <Dropdown
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      toggle={(ref) => (
        <MenuToggle
          id="profile-selector-dropdown"
          ref={ref || toggleRef}
          onClick={() => setIsOpen((prev) => !prev)}
          isExpanded={isOpen}
          isDisabled={isDisabled}
          style={{ width: 220 }}
        >
          {selected?.name ?? "Select a profile"}
        </MenuToggle>
      )}
    >
      <MenuSearch>
        <MenuSearchInput>
          <InputGroup>
            <InputGroupItem isFill>
              <SearchInput
                value={searchInput}
                placeholder="Search profiles"
                onChange={(_e, val) => setSearchInput(val)}
              />
            </InputGroupItem>
            <InputGroupItem>
              <Button
                variant={ButtonVariant.control}
                icon={<SearchIcon />}
                onClick={() => {}}
                aria-label="Search profiles"
              />
            </InputGroupItem>
          </InputGroup>
        </MenuSearchInput>
      </MenuSearch>

      <Divider />

      <DropdownList>
        {filtered.length > 0 ? (
          filtered.map((p) => (
            <DropdownItem
              key={p.id}
              itemId={p.id}
              onClick={() => {
                onChange(p.id);
                setIsOpen(false);
              }}
              icon={p.id === activeProfile ? <CheckIcon /> : p.readOnly ? <LockIcon /> : undefined}
            >
              {p.name}
            </DropdownItem>
          ))
        ) : (
          <DropdownItem isDisabled>No profiles found</DropdownItem>
        )}
      </DropdownList>

      {!isInTreeMode && (
        <>
          <Divider />

          <DropdownItem
            key="manage-profiles"
            id="manage-profiles-dropdown-item"
            onClick={() => {
              setIsOpen(false);
              onManageProfiles();
            }}
            icon={<CogIcon />}
            style={{ fontStyle: "italic", opacity: 0.9 }}
          >
            Manage Profiles
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
};
