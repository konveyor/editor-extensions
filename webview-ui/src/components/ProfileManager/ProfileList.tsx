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

export const ProfileList: React.FC<{
  profiles: any[];
  selected: string | null;
  active: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}> = ({ profiles, selected, active, onSelect, onCreate }) => {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  return (
    <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }}>
      <FlexItem>
        <Button variant="primary" onClick={onCreate} isBlock>
          + New Profile
        </Button>
      </FlexItem>
      <FlexItem>
        <DataList aria-label="Profile list">
          {profiles.map((profile) => (
            <DataListItem key={profile.id} aria-labelledby={`profile-${profile.id}`}>
              <DataListItemRow>
                <DataListItemCells
                  dataListCells={[
                    <DataListCell key="name">
                      <span
                        id={`profile-${profile.id}`}
                        style={{ fontWeight: selected === profile.id ? "bold" : undefined }}
                      >
                        {profile.name} {active === profile.id && <em>(active)</em>}
                      </span>
                    </DataListCell>,
                  ]}
                />
                <DataListAction
                  aria-labelledby={`profile-${profile.id}`}
                  id={`actions-${profile.id}`}
                  aria-label="Actions"
                >
                  <Dropdown
                    popperProps={{ position: "right" }}
                    isOpen={openDropdown === profile.id}
                    onSelect={() => setOpenDropdown(null)}
                    toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
                      <MenuToggle
                        ref={toggleRef}
                        isExpanded={openDropdown === profile.id}
                        onClick={() =>
                          setOpenDropdown(openDropdown === profile.id ? null : profile.id)
                        }
                        variant="plain"
                        aria-label="Actions"
                        icon={<EllipsisVIcon />}
                      />
                    )}
                    onOpenChange={(isOpen) => setOpenDropdown(isOpen ? profile.id : null)}
                  >
                    <DropdownList>
                      <DropdownItem onClick={() => onSelect(profile.id)}>Edit</DropdownItem>
                    </DropdownList>
                  </Dropdown>
                </DataListAction>
              </DataListItemRow>
            </DataListItem>
          ))}
        </DataList>
      </FlexItem>
    </Flex>
  );
};
