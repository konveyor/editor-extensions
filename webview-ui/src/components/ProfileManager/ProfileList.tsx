import React from "react";
import {
  DataList,
  DataListItem,
  DataListItemRow,
  DataListItemCells,
  DataListCell,
  Button,
  Flex,
  FlexItem,
  Icon,
} from "@patternfly/react-core";
import { AnalysisProfile } from "../../../../shared/dist/types";
import LockIcon from "@patternfly/react-icons/dist/esm/icons/lock-icon";
import StarIcon from "@patternfly/react-icons/dist/esm/icons/star-icon";
import OutlinedStarIcon from "@patternfly/react-icons/dist/esm/icons/outlined-star-icon";
import TrashIcon from "@patternfly/react-icons/dist/esm/icons/trash-icon";
import { PencilAltIcon } from "@patternfly/react-icons";

export const ProfileList: React.FC<{
  profiles: AnalysisProfile[];
  selected: string | null;
  active: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onMakeActive: (id: string) => void;
  onDelete: (id: string) => void;
}> = ({ profiles, selected, active, onSelect, onCreate, onDelete, onMakeActive }) => {
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
                      <Flex
                        justifyContent={{ default: "justifyContentSpaceBetween" }}
                        alignItems={{ default: "alignItemsCenter" }}
                      >
                        <FlexItem style={{ minWidth: "250px", maxWidth: "300px", flexShrink: 0 }}>
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
                            <span
                              id={`profile-${profile.id}`}
                              style={{ fontWeight: selected === profile.id ? "bold" : undefined }}
                            >
                              {profile.name} {active === profile.id && <em>(active)</em>}
                            </span>
                          </Flex>
                        </FlexItem>

                        <FlexItem>
                          <Flex
                            alignItems={{ default: "alignItemsCenter" }}
                            spaceItems={{ default: "spaceItemsSm" }}
                          >
                            <Button
                              variant="control"
                              size="sm"
                              aria-label="Make active"
                              onClick={() => onMakeActive(profile.id)}
                              isDisabled={active === profile.id}
                            >
                              <Icon
                                color={active === profile.id ? "gold" : undefined}
                                aria-label="Make active"
                                isInline
                                size="sm"
                              >
                                {active === profile.id ? <StarIcon /> : <OutlinedStarIcon />}
                              </Icon>
                            </Button>
                            <Button
                              variant="control"
                              size="sm"
                              aria-label="Delete"
                              isDisabled={profile.readOnly}
                              onClick={() => onDelete(profile.id)}
                            >
                              <Icon aria-label="Delete" isInline size="sm">
                                <TrashIcon />
                              </Icon>
                            </Button>
                            <Button
                              variant="control"
                              size="sm"
                              aria-label="Edit"
                              onClick={() => onSelect(profile.id)}
                            >
                              <Icon aria-label="Edit" isInline size="sm">
                                <PencilAltIcon />
                              </Icon>
                            </Button>
                          </Flex>
                        </FlexItem>
                      </Flex>
                    </DataListCell>,
                  ]}
                />
              </DataListItemRow>
            </DataListItem>
          ))}
        </DataList>
      </FlexItem>
    </Flex>
  );
};
