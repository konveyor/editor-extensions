import React, { useState } from "react";
import {
  Page,
  PageSection,
  EmptyState,
  EmptyStateBody,
  EmptyStateFooter,
  EmptyStateActions,
  Button,
  PageSidebar,
  PageSidebarBody,
  Masthead,
  MastheadMain,
  MastheadBrand,
  MastheadContent,
  Dropdown,
  DropdownList,
  DropdownItem,
  Divider,
  MenuToggle,
  MenuToggleAction,
  Flex,
  FlexItem,
  Label,
  Title,
} from "@patternfly/react-core";
import StarIcon from "@patternfly/react-icons/dist/esm/icons/star-icon";
import LockIcon from "@patternfly/react-icons/dist/esm/icons/lock-icon";
import CheckCircleIcon from "@patternfly/react-icons/dist/esm/icons/check-circle-icon";
import CubesIcon from "@patternfly/react-icons/dist/esm/icons/cubes-icon";
import { useExtensionStore } from "../../store/store";
import { sendVscodeMessage as dispatch } from "../../utils/vscodeMessaging";
import { ProfileList } from "./ProfileList";
import { ProfileEditorForm } from "./ProfileEditorForm";
import { AnalysisProfile } from "../../../../shared/dist/types";

export const ProfileManagerPage: React.FC = () => {
  // ✅ Selective subscriptions
  const profiles = useExtensionStore((state) => state.profiles);
  const activeProfileId = useExtensionStore((state) => state.activeProfileId);
  const isAnalyzing = useExtensionStore((state) => state.isAnalyzing);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    activeProfileId ?? profiles[0]?.id ?? null,
  );
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);

  const isActiveProfile = selectedProfile?.id === activeProfileId;

  const handleProfileChange = (updatedProfile: AnalysisProfile) => {
    dispatch({
      type: "UPDATE_PROFILE",
      payload: {
        originalId: selectedProfileId,
        updatedProfile,
      },
    });

    if (updatedProfile.id !== selectedProfileId) {
      setSelectedProfileId(updatedProfile.id);
    }
  };

  const handleDuplicateProfile = (profile: AnalysisProfile) => {
    const baseName = profile.name;
    let index = 1;
    let newName = baseName;
    while (profiles.some((p) => p.name === newName)) {
      newName = `${baseName} ${index++}`;
    }
    const newProfile: AnalysisProfile = {
      ...profile,
      id: crypto.randomUUID(),
      name: newName,
    };
    dispatch({ type: "ADD_PROFILE", payload: newProfile });
    setSelectedProfileId(newProfile.id);
  };

  const handleCreateProfile = () => {
    const baseName = "New Profile";
    let index = 1;
    let newName = baseName;
    while (profiles.some((p) => p.name === newName)) {
      newName = `${baseName} ${index++}`;
    }

    const newProfile: AnalysisProfile = {
      id: crypto.randomUUID(),
      name: newName,
      customRules: [],
      useDefaultRules: true,
      labelSelector: "",
    };

    dispatch({ type: "ADD_PROFILE", payload: newProfile });
    setSelectedProfileId(newProfile.id);
  };

  const handleDeleteProfile = (id: string) => {
    dispatch({ type: "DELETE_PROFILE", payload: id });
    if (selectedProfileId === id) {
      setSelectedProfileId(null);
    }
  };

  const handleMakeActive = (id: string) => {
    dispatch({ type: "SET_ACTIVE_PROFILE", payload: id });
  };

  const handleOpenHubSettings = () => {
    dispatch({ type: "OPEN_HUB_SETTINGS", payload: {} });
  };

  const hasProfiles = profiles.length > 0;

  return (
    <Page
      sidebar={
        <PageSidebar isSidebarOpen={false}>
          <PageSidebarBody />
        </PageSidebar>
      }
      masthead={
        hasProfiles ? (
          <Masthead>
            <MastheadMain style={{ width: "220px", justifyContent: "center" }}>
              <MastheadBrand>
                <Dropdown
                  isOpen={isDropdownOpen}
                  onOpenChange={setIsDropdownOpen}
                  onSelect={() => setIsDropdownOpen(false)}
                  popperProps={{
                    position: "start",
                    preventOverflow: true,
                    appendTo: "inline",
                  }}
                  toggle={(toggleRef) => (
                    <MenuToggle
                      ref={toggleRef}
                      isExpanded={isDropdownOpen}
                      variant="primary"
                      splitButtonItems={[
                        <MenuToggleAction
                          key="new-profile-action"
                          onClick={handleCreateProfile}
                          isDisabled={isAnalyzing}
                          aria-label="Create new profile"
                        >
                          New Profile
                        </MenuToggleAction>,
                      ]}
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    />
                  )}
                >
                  <DropdownList>
                    <DropdownItem key="new-profile" onClick={handleCreateProfile}>
                      New Profile
                    </DropdownItem>
                    <Divider />
                    <DropdownItem
                      key="import-profile"
                      onClick={handleOpenHubSettings}
                      description="Connect to Konveyor Hub to sync profiles"
                    >
                      Import...
                    </DropdownItem>
                  </DropdownList>
                </Dropdown>
              </MastheadBrand>
            </MastheadMain>
            {selectedProfile && (
              <MastheadContent style={{ width: "100%" }}>
                <Flex
                  justifyContent={{ default: "justifyContentSpaceBetween" }}
                  alignItems={{ default: "alignItemsCenter" }}
                  style={{ width: "100%" }}
                >
                  <Flex alignItems={{ default: "alignItemsCenter" }} spaceItems={{ default: "spaceItemsSm" }}>
                    <FlexItem>
                      <Title headingLevel="h1" size="md">
                        {selectedProfile.name}
                      </Title>
                    </FlexItem>
                    {isActiveProfile && (
                      <FlexItem>
                        <Label color="blue" isCompact icon={<StarIcon />}>
                          active
                        </Label>
                      </FlexItem>
                    )}
                    {selectedProfile.readOnly && (
                      <FlexItem>
                        <Label isCompact icon={<LockIcon />}>
                          read-only
                        </Label>
                      </FlexItem>
                    )}
                  </Flex>
                  <Flex alignItems={{ default: "alignItemsCenter" }} spaceItems={{ default: "spaceItemsXs" }}>
                    <FlexItem>
                      <CheckCircleIcon
                        color="var(--pf-t--global--icon--color--status--success--default)"
                        style={{ fontSize: "0.75rem" }}
                      />
                    </FlexItem>
                    <FlexItem>
                      <span style={{ fontSize: "0.75rem", color: "var(--pf-t--global--text--color--subtle)" }}>
                        Auto-saved
                      </span>
                    </FlexItem>
                  </Flex>
                </Flex>
              </MastheadContent>
            )}
          </Masthead>
        ) : undefined
      }
    >
      {hasProfiles ? (
        <div style={{ display: "flex", height: "calc(100vh - 56px)", overflow: "hidden" }}>
          {/* Fixed left sidebar */}
          <div
            style={{
              width: "220px",
              flexShrink: 0,
              borderRight: "1px solid var(--pf-t--global--border--color--default)",
              padding: "1rem",
              overflow: "hidden",
            }}
          >
            <ProfileList
              profiles={profiles}
              selected={selectedProfileId}
              active={activeProfileId}
              onSelect={setSelectedProfileId}
              onDelete={handleDeleteProfile}
              onMakeActive={handleMakeActive}
              onDuplicate={handleDuplicateProfile}
              isDisabled={isAnalyzing}
            />
          </div>
          {/* Scrollable right panel */}
          <div style={{ flex: 1, overflowY: "auto", padding: "1rem" }}>
              {selectedProfile ? (
                <ProfileEditorForm
                  allProfiles={profiles}
                  profile={selectedProfile}
                  isActive={isActiveProfile}
                  onChange={handleProfileChange}
                  onDelete={handleDeleteProfile}
                  onMakeActive={handleMakeActive}
                  isDisabled={isAnalyzing}
                />
              ) : (
                <EmptyState
                  headingLevel="h2"
                  icon={CubesIcon}
                  titleText="Select a profile"
                  isFullHeight
                >
                  <EmptyStateBody>
                    Choose a profile from the list to view and edit its configuration.
                  </EmptyStateBody>
                </EmptyState>
              )}
          </div>
        </div>
      ) : (
        <PageSection isFilled>
          <EmptyState
            headingLevel="h2"
            icon={CubesIcon}
            titleText="No profiles yet"
            isFullHeight
          >
            <EmptyStateBody>
              Profiles let you configure analysis rules, label selectors, and targets for your
              migration projects. Create a new profile or import from Konveyor Hub.
            </EmptyStateBody>
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button variant="primary" onClick={handleCreateProfile} isDisabled={isAnalyzing}>
                  New Profile
                </Button>
                <Button variant="link" onClick={handleOpenHubSettings}>
                  Import...
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          </EmptyState>
        </PageSection>
      )}
    </Page>
  );
};
