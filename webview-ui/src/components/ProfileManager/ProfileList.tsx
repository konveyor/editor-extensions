import React from "react";
import {
  SimpleList,
  SimpleListItem,
  Dropdown,
  DropdownList,
  DropdownItem,
  MenuToggle,
  MenuToggleElement,
  Flex,
  FlexItem,
} from "@patternfly/react-core";
import { AnalysisProfile } from "../../../../shared/dist/types";
import LockIcon from "@patternfly/react-icons/dist/esm/icons/lock-icon";
import StarIcon from "@patternfly/react-icons/dist/esm/icons/star-icon";
import EllipsisVIcon from "@patternfly/react-icons/dist/esm/icons/ellipsis-v-icon";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";

export const ProfileList: React.FC<{
  profiles: AnalysisProfile[];
  selected: string | null;
  active: string | null;
  onSelect: (id: string) => void;
  onMakeActive: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (profile: AnalysisProfile) => void;
  isDisabled?: boolean;
}> = ({
  profiles,
  selected,
  active,
  onSelect,
  onDelete,
  onMakeActive,
  onDuplicate,
  isDisabled = false,
}) => {
  const [openDropdownProfileId, setOpenDropdownProfileId] = React.useState<string | null>(null);
  const [profileToDelete, setProfileToDelete] = React.useState<AnalysisProfile | null>(null);

  return (
    <>
      <SimpleList aria-label="Profile list">
        {profiles.map((profile) => {
          const isOpen = openDropdownProfileId === profile.id;
          const setIsOpen = (nextOpen: boolean) => {
            setOpenDropdownProfileId(nextOpen ? profile.id : null);
          };
          const isActive = active === profile.id;
          const isSelected = selected === profile.id;

          return (
            <SimpleListItem
              key={profile.id}
              isActive={isSelected}
              onClick={() => onSelect(profile.id)}
            >
              <Flex
                justifyContent={{ default: "justifyContentSpaceBetween" }}
                alignItems={{ default: "alignItemsCenter" }}
                flexWrap={{ default: "nowrap" }}
                style={{ width: "100%" }}
              >
                <FlexItem style={{ minWidth: 0, flex: "1 1 auto" }}>
                  <Flex
                    alignItems={{ default: "alignItemsCenter" }}
                    spaceItems={{ default: "spaceItemsSm" }}
                    flexWrap={{ default: "nowrap" }}
                  >
                    {profile.readOnly && (
                      <FlexItem style={{ flexShrink: 0 }}>
                        <LockIcon color="var(--pf-t--global--icon--color--subtle)" style={{ fontSize: "0.75rem" }} />
                      </FlexItem>
                    )}
                    {isActive && (
                      <FlexItem style={{ flexShrink: 0 }}>
                        <StarIcon color="var(--pf-t--global--icon--color--brand--default)" style={{ fontSize: "0.75rem" }} />
                      </FlexItem>
                    )}
                    <FlexItem style={{ minWidth: 0 }}>
                      <span style={{ fontSize: "0.875rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
                        {profile.name}
                      </span>
                    </FlexItem>
                  </Flex>
                </FlexItem>
                <FlexItem style={{ flexShrink: 0 }}>
                  <Dropdown
                    popperProps={{ position: "right", appendTo: "inline" }}
                    isOpen={isOpen}
                    onOpenChange={(nextOpen) => setIsOpen(nextOpen)}
                    onSelect={() => setIsOpen(false)}
                    toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
                      <MenuToggle
                        ref={toggleRef}
                        isExpanded={isOpen}
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsOpen(!isOpen);
                        }}
                        variant="plain"
                        style={{ padding: "0.25rem" }}
                      >
                        <EllipsisVIcon />
                      </MenuToggle>
                    )}
                  >
                    <DropdownList>
                      {!isActive && (
                        <DropdownItem
                          key="make-active"
                          onClick={() => onMakeActive(profile.id)}
                          isDisabled={isDisabled}
                        >
                          Make Active
                        </DropdownItem>
                      )}
                      <DropdownItem
                        key="duplicate"
                        onClick={() => {
                          onDuplicate(profile);
                          setIsOpen(false);
                        }}
                        isDisabled={isDisabled}
                      >
                        Duplicate
                      </DropdownItem>
                      <DropdownItem
                        key="delete"
                        onClick={() => {
                          setProfileToDelete(profile);
                          setIsOpen(false);
                        }}
                        isDisabled={profile.readOnly}
                        isDanger
                      >
                        Delete
                      </DropdownItem>
                    </DropdownList>
                  </Dropdown>
                </FlexItem>
              </Flex>
            </SimpleListItem>
          );
        })}
      </SimpleList>
      <ConfirmDialog
        isOpen={profileToDelete !== null}
        title="Delete profile?"
        message={`Are you sure you want to delete the profile "${profileToDelete?.name}"? This action cannot be undone.`}
        confirmButtonText="Delete"
        onConfirm={() => {
          if (profileToDelete) {
            onDelete(profileToDelete.id);
          }
          setProfileToDelete(null);
        }}
        onCancel={() => setProfileToDelete(null)}
      />
    </>
  );
};
