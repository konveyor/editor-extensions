import React, { useRef, useState } from "react";
import {
  Page,
  PageSection,
  Split,
  SplitItem,
  Bullseye,
  Content,
  ContentVariants,
  Spinner,
} from "@patternfly/react-core";
import { useExtensionStateContext } from "../../context/ExtensionStateContext";
import { ProfileList } from "./ProfileList";
import { ProfileEditorForm } from "./ProfileEditorForm";

export const ProfileManagerPage: React.FC = () => {
  const { state, dispatch } = useExtensionStateContext();
  const { profiles, activeProfileName } = state;

  const [selectedProfileName, setSelectedProfileName] = useState(
    activeProfileName || profiles[0]?.name,
  );
  const [localSelectedProfile, setLocalSelectedProfile] = useState(
    profiles.find((p) => p.name === selectedProfileName) ?? null,
  );

  React.useEffect(() => {
    const fresh = profiles.find((p) => p.name === selectedProfileName);
    if (fresh) {
      setLocalSelectedProfile(fresh);
    }
    // 👇 do not set to null here
  }, [profiles, selectedProfileName]);

  const handleProfileChange = (updatedProfile) => {
    if (updatedProfile.name !== selectedProfileName) {
      setSelectedProfileName(updatedProfile.name);
    }

    setLocalSelectedProfile(updatedProfile);

    dispatch({
      type: "UPDATE_PROFILE",
      payload: {
        originalName: selectedProfileName,
        updatedProfile,
      },
    });
  };

  const handleCreateProfile = () => {
    const baseName = "New Profile";
    let index = 1;
    let newName = baseName;
    while (profiles.find((p) => p.name === newName)) {
      newName = `${baseName} ${index++}`;
    }
    const newProfile = {
      name: newName,
      mode: "source-only",
      customRules: [],
      useDefaultRules: true,
      labelSelector: "",
    };
    dispatch({ type: "ADD_PROFILE", payload: newProfile });
    // window.vscode.postMessage({ type: "ADD_PROFILE", payload: newProfile });
    setSelectedProfileName(newProfile.name);
  };

  const handleDeleteProfile = () => {
    if (selectedProfileName) {
      window.vscode.postMessage({ type: "DELETE_PROFILE", payload: selectedProfileName });
      setSelectedProfileName("");
    }
  };

  const handleMakeActive = (name: string) => {
    dispatch({ type: "SET_ACTIVE_PROFILE", payload: name });
    window.vscode.postMessage({ type: "SET_ACTIVE_PROFILE", payload: name });
  };

  return (
    <Page>
      <PageSection isFilled>
        <Split hasGutter>
          <SplitItem isFilled style={{ width: "300px", flex: "0 0 300px" }}>
            <ProfileList
              profiles={profiles}
              selected={selectedProfileName}
              active={activeProfileName}
              onSelect={setSelectedProfileName}
              onCreate={handleCreateProfile}
            />
          </SplitItem>
          <SplitItem isFilled style={{ flex: "1 1 auto" }}>
            {profiles.length === 0 ? (
              <Bullseye>
                <Content component={ContentVariants.p}>No profiles defined</Content>
              </Bullseye>
            ) : localSelectedProfile ? (
              <ProfileEditorForm
                profile={localSelectedProfile}
                isActive={localSelectedProfile.name === activeProfileName}
                onChange={handleProfileChange}
                onDelete={handleDeleteProfile}
                onMakeActive={handleMakeActive}
              />
            ) : (
              <Bullseye>
                {/* <Content component={ContentVariants.p}>Loading profile…</Content> */}
                <Spinner size="xl" aria-label="Loading profile…" style={{ margin: "auto" }} />
              </Bullseye>
            )}
          </SplitItem>
        </Split>
      </PageSection>
    </Page>
  );
};
