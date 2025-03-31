import React from "react";
import {
  Card,
  CardHeader,
  CardBody,
  Gallery,
  GalleryItem,
  Title,
  DrawerPanelContent,
  DrawerHead,
  DrawerActions,
  DrawerCloseButton,
  DrawerContentBody,
  Content,
} from "@patternfly/react-core";
import CheckCircleIcon from "@patternfly/react-icons/dist/esm/icons/check-circle-icon";
import PendingIcon from "@patternfly/react-icons/dist/esm/icons/pending-icon";
import { AnalysisConfig } from "@editor-extensions/shared";
import "./WalkthroughDrawer.css";
import { useExtensionStateContext } from "../../../context/ExtensionStateContext";

interface WalkthroughDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  drawerRef: React.RefObject<HTMLSpanElement>;
  analysisConfig: AnalysisConfig;
}

function getStepStatus(step: { id: string }, analysisConfig?: AnalysisConfig) {
  const valid = analysisConfig?.labelSelectorValid;
  return valid
    ? { icon: <CheckCircleIcon className="status-icon--completed" />, status: "Completed" }
    : { icon: <PendingIcon className="status-icon--not-configured" />, status: "Not configured" };
}

export function WalkthroughDrawer({
  isOpen,
  onClose,
  drawerRef,
  analysisConfig,
}: WalkthroughDrawerProps) {
  const { icon, status } = getStepStatus({ id: "configure-analysis-arguments" }, analysisConfig);
  const { state, dispatch } = useExtensionStateContext();

  const handleConfigureSourcesTargets = () => {
    dispatch({
      type: "CONFIGURE_SOURCES_TARGETS",
      payload: {},
    });
  };

  return (
    <DrawerPanelContent>
      <DrawerHead>
        <span tabIndex={isOpen ? 0 : -1} ref={drawerRef}>
          <Title headingLevel="h2">Set up Konveyor</Title>
          <Content>Configure Konveyor for your project</Content>
        </span>
        <DrawerActions>
          <DrawerCloseButton onClick={onClose} />
        </DrawerActions>
      </DrawerHead>
      <DrawerContentBody>
        <Gallery hasGutter>
          <GalleryItem>
            <Card isCompact>
              <CardHeader>
                <Title headingLevel="h3">
                  {icon}
                  <span>Configure Analysis Arguments</span>
                </Title>
              </CardHeader>
              <CardBody>
                <Content>
                  Set up analysis arguments such as sources, targets, and label selector
                </Content>
                <Content className="status-text">Status: {status}</Content>
                <Content>
                  <button className="configure-button" onClick={handleConfigureSourcesTargets}>
                    Configure
                  </button>
                </Content>
              </CardBody>
            </Card>
          </GalleryItem>
        </Gallery>
      </DrawerContentBody>
    </DrawerPanelContent>
  );
}
