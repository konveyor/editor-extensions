import React from "react";
import {
  DataList,
  DataListItem,
  DataListItemRow,
  DataListItemCells,
  DataListCell,
  DataListAction,
  Dropdown,
  DropdownList,
  DropdownItem,
  MenuToggle,
  MenuToggleElement,
  Button,
  Flex,
  FlexItem,
  Icon,
} from "@patternfly/react-core";
import { AnalysisProfile } from "../../../../shared/dist/types";
import LockIcon from "@patternfly/react-icons/dist/esm/icons/lock-icon";
import EllipsisVIcon from "@patternfly/react-icons/dist/esm/icons/ellipsis-v-icon";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";

export const ProfileList: React.FC<{
  profiles: AnalysisProfile[];
  selected: string | null;
  active: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onMakeActive: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (profile: AnalysisProfile) => void;
  isDisabled?: boolean;
}> = ({
  profiles,
  selected,
  active,
  onSelect,
  onCreate,
  onDelete,
  onMakeActive,
  onDuplicate,
  isDisabled = false,
}) => {
  const [openDropdownProfileId, setOpenDropdownProfileId] = React.useState<string | null>(null);
  const [profileToDelete, setProfileToDelete] = React.useState<AnalysisProfile | null>(null);

  return (
    <Flex direction={{ default: "column" }} spaceItems={{ default: "spaceItemsMd" }}>
      <FlexItem>
        <Button variant="primary" onClick={onCreate} isBlock isDisabled={isDisabled}>
          + New Profile
        </Button>
      </FlexItem>
      <FlexItem>
        <DataList
          aria-label="Profile list"
          selectedDataListItemId={selected || ""}
          onSelectDataListItem={(_e, id) => onSelect(id)}
        >
          {profiles.map((profile) => {
            const isOpen = openDropdownProfileId === profile.id;
            const setIsOpen = (nextOpen: boolean) => {
              setOpenDropdownProfileId(nextOpen ? profile.id : null);
            };

            return (
              <DataListItem
                key={profile.id}
                id={profile.id}
                aria-labelledby={`profile-${profile.id}`}
              >
                <DataListItemRow>
                  <DataListItemCells
                    dataListCells={[
                      <DataListCell key="name">
                        <Flex alignItems={{ default: "alignItemsCenter" }}>
                          {profile.readOnly && (
                            <Icon
                              style={{ marginRight: "0.5em" }}
                              aria-label="Readonly profile"
                              isInline
                            >
                              <LockIcon color="gray" />
                            </Icon>
                          )}
                          <span id={`profile-${profile.id}`}>
                            {profile.name} {active === profile.id && <em>(active)</em>}
                          </span>
                        </Flex>
                      </DataListCell>,
                    ]}
                  />
                  <DataListAction
                    aria-labelledby={`profile-${profile.id}`}
                    id={`profile-action-${profile.id}`}
                    aria-label="Profile actions"
                  >
                    <Dropdown
                      popperProps={{ position: "right" }}
                      isOpen={isOpen}
                      onOpenChange={(nextOpen) => setIsOpen(nextOpen)}
                      onSelect={() => setIsOpen(false)}
                      toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
                        <MenuToggle
                          ref={toggleRef}
                          isExpanded={isOpen}
                          onClick={() => setIsOpen(!isOpen)}
                          variant="plain"
                          icon={<EllipsisVIcon />}
                          aria-label="Profile actions menu"
                        />
                      )}
                    >
                      <DropdownList>
                        <DropdownItem
                          key="make-active"
                          onClick={() => onMakeActive(profile.id)}
                          isDisabled={active === profile.id || isDisabled}
                          description={
                            active === profile.id
                              ? "This profile is already active. No action needed."
                              : isDisabled
                                ? "Profile operations are blocked during analysis or solution generation."
                                : ""
                          }
                        >
                          {active === profile.id ? "Active" : "Make Active"}
                        </DropdownItem>
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
                        >
                          Delete
                        </DropdownItem>
                      </DropdownList>
                    </Dropdown>
                  </DataListAction>
                </DataListItemRow>
              </DataListItem>
            );
          })}
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
        </DataList>
      </FlexItem>
    </Flex>
  );
};
