import React, { useEffect, useState } from "react";
import {
  Page,
  PageSection,
  Split,
  SplitItem,
  Bullseye,
  Content,
  ContentVariants,
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
  console.log("activeProfileId:", activeProfileId);

  //debig
  useEffect(() => {
    console.log(
      "profiles updated:",
      profiles.map((p) => p.id),
    );
    console.log("selectedProfileId:", selectedProfileId);
    console.log(
      "selectedProfile:",
      profiles.find((p) => p.id === selectedProfileId),
    );
  }, [profiles, selectedProfileId]);

  //

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

    // Keep selection in sync if ID changes (shouldn’t happen now, but good practice)
    if (updatedProfile.id !== selectedProfileId) {
      setSelectedProfileId(updatedProfile.id);
    }
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
      mode: "source-only",
      customRules: [],
      useDefaultRules: true,
      labelSelector: "",
    };

    dispatch({ type: "ADD_PROFILE", payload: newProfile });
    setSelectedProfileId(newProfile.id); // <- Keep this
  };

  const handleDeleteProfile = () => {
    if (selectedProfileId) {
      window.vscode.postMessage({ type: "DELETE_PROFILE", payload: selectedProfileId });
      setSelectedProfileId(null);
    }
  };

  const handleMakeActive = (id: string) => {
    dispatch({ type: "SET_ACTIVE_PROFILE", payload: id });
    window.vscode.postMessage({ type: "SET_ACTIVE_PROFILE", payload: id });
  };

  return (
    <Page>
      <PageSection isFilled>
        <Split hasGutter>
          <SplitItem isFilled style={{ width: "300px", flex: "0 0 300px" }}>
            <ProfileList
              profiles={profiles}
              selected={selectedProfileId}
              active={activeProfileId}
              onSelect={setSelectedProfileId}
              onCreate={handleCreateProfile}
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
