import React from "react";
import {
  Page,
  PageSection,
  PageSidebar,
  PageSidebarBody,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Flex,
  FlexItem,
  Stack,
  StackItem,
} from "@patternfly/react-core";
import { ArrowLeftIcon } from "@patternfly/react-icons";
import { ExtensionData, LocalChange } from "@editor-extensions/shared";
import "./solutionOverlay.css";
import { FileChanges } from "../FileChanges/FileChanges";

interface SolutionOverlayProps {
  onClose: () => void;
  state: ExtensionData;
  onFileClick: (change: LocalChange) => void;
  onApplyFix: (change: LocalChange) => void;
  onRejectChanges: (change: LocalChange) => void;
}

export const SolutionOverlay: React.FC<SolutionOverlayProps> = ({
  onClose,
  state,
  onFileClick,
  onApplyFix,
  onRejectChanges,
}) => {
  const changes = state.localChanges;
  return (
    <div className="solution-overlay">
      <div className="solution-header">
        <Flex className="header-content">
          <FlexItem>
            <Button variant="plain" onClick={onClose} className="back-button">
              <ArrowLeftIcon />
              <span className="ml-2">Back to Chat</span>
            </Button>
          </FlexItem>
          <FlexItem align={{ default: "alignRight" }}>
            <Flex>
              <FlexItem>
                <Button
                  variant="primary"
                  onClick={() => changes.forEach(onApplyFix)}
                  isDisabled={changes.length === 0}
                >
                  Apply All Changes
                </Button>
              </FlexItem>
            </Flex>
          </FlexItem>
        </Flex>
      </div>
      <div className="solution-content">
        <Page
          sidebar={
            <PageSidebar isSidebarOpen={false}>
              <PageSidebarBody />
            </PageSidebar>
          }
        >
          <PageSection>
            <Stack hasGutter>
              <StackItem>
                <Card>
                  <CardHeader>
                    <Flex className="header-layout">
                      <FlexItem>
                        <CardTitle>Proposed Changes</CardTitle>
                        <div className="text-sm text-gray-600">
                          {changes.length} file{changes.length !== 1 ? "s" : ""} to be modified
                        </div>
                      </FlexItem>
                    </Flex>
                  </CardHeader>
                  <CardBody>
                    <FileChanges
                      changes={changes}
                      onFileClick={onFileClick}
                      onApplyFix={onApplyFix}
                      onRejectChanges={onRejectChanges}
                    />
                  </CardBody>
                </Card>
              </StackItem>
            </Stack>
          </PageSection>
        </Page>
      </div>
    </div>
  );
};
