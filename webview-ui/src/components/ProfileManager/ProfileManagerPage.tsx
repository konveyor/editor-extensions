import React, { useState } from "react";
import {
  Page,
  PageSection,
  Split,
  SplitItem,
  Bullseye,
  Content,
  ContentVariants,
  PageSidebar,
  PageSidebarBody,
} from "@patternfly/react-core";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";
import { ProfileList } from "./ProfileList";
import { ProfileEditorForm } from "./ProfileEditorForm";
import { AnalysisProfile } from "../../../../shared/dist/types";

export const ProfileManagerPage: React.FC = () => {
  const { state, dispatch } = useExtensionStateContext();
  const { profiles, activeProfileId } = state;
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    activeProfileId ?? profiles[0]?.id ?? null,
  );
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
    setSelectedProfileId(newProfile.id); // <- Keep this
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

  return (
    <Page
      sidebar={
        <PageSidebar isSidebarOpen={false}>
          <PageSidebarBody />
        </PageSidebar>
      }
    >
      <PageSection isFilled>
        <Split hasGutter>
          <SplitItem isFilled style={{ width: "300px", flex: "0 0 300px" }}>
            <ProfileList
              profiles={profiles}
              selected={selectedProfileId}
              active={activeProfileId}
              onSelect={setSelectedProfileId}
              onCreate={handleCreateProfile}
              onDelete={handleDeleteProfile}
              onMakeActive={handleMakeActive}
              onDuplicate={handleDuplicateProfile}
            />
          </SplitItem>
          <SplitItem isFilled style={{ flex: "1 1 auto" }}>
            {selectedProfile ? (
              <ProfileEditorForm
                allProfiles={profiles}
                profile={selectedProfile}
                isActive={isActiveProfile}
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
