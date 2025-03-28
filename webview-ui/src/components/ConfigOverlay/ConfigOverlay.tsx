import React from "react";
import {
  Drawer,
  DrawerContent,
  DrawerContentBody,
  DrawerPanelContent,
  Button,
  Title,
} from "@patternfly/react-core";
import { TimesIcon } from "@patternfly/react-icons";

interface ConfigOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  variant?: "overlay" | "drawer" | "embedded";
}

const ConfigOverlay: React.FC<ConfigOverlayProps> = ({ isOpen, onClose, variant = "overlay" }) => {
  if (variant === "drawer") {
    console.log("ConfigOverlay: drawer variant");
    return (
      <Drawer isExpanded={isOpen} isInline={false}>
        <DrawerContent
          panelContent={
            <DrawerPanelContent>
              <div style={{ padding: "1rem" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "1rem",
                  }}
                >
                  <Title headingLevel="h2">Configuration</Title>
                  <Button variant="plain" onClick={onClose}>
                    <TimesIcon />
                  </Button>
                </div>
                <p>Configuration Content Goes Here</p>
              </div>
            </DrawerPanelContent>
          }
        >
          <DrawerContentBody>
            hello this is main content body
            {/* Main content remains visible */}
          </DrawerContentBody>
        </DrawerContent>
      </Drawer>
    );
  }

  return null;
};

export default ConfigOverlay;
