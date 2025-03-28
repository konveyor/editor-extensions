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
import { CheckCircleIcon, InProgressIcon, PendingIcon } from "@patternfly/react-icons";

interface Step {
  id: string;
  title: string;
  description: string;
  completionEvents: string[];
  media: {
    markdown: string;
  };
}

interface Walkthrough {
  id: string;
  title: string;
  description: string;
  steps: Step[];
}

interface WalkthroughDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  drawerRef: React.RefObject<HTMLSpanElement>;
  walkthroughs: Walkthrough[];
}

function getStepStatus(step: Step) {
  if (step.completionEvents.length === 0) {
    return { icon: <PendingIcon className="text-gray-500" />, status: "Not started" };
  }
  // This is a placeholder - you would typically check against actual completion events
  const isCompleted = false; // Replace with actual completion check
  return isCompleted
    ? { icon: <CheckCircleIcon className="text-green-500" />, status: "Completed" }
    : { icon: <InProgressIcon className="text-blue-500" />, status: "In progress" };
}

export function WalkthroughDrawer({
  isOpen,
  onClose,
  drawerRef,
  walkthroughs,
}: WalkthroughDrawerProps) {
  return (
    <DrawerPanelContent>
      <DrawerHead>
        <span tabIndex={isOpen ? 0 : -1} ref={drawerRef}>
          Konveyor Setup Guide
        </span>
        <DrawerActions>
          <DrawerCloseButton onClick={onClose} />
        </DrawerActions>
      </DrawerHead>
      <DrawerContentBody>
        <div className="p-4">
          {walkthroughs.map((walkthrough) => (
            <div key={walkthrough.id} className="mb-8">
              <Title headingLevel="h2" className="mb-4">
                {walkthrough.title}
              </Title>
              <Content className="mb-6">{walkthrough.description}</Content>
              <Gallery hasGutter>
                {walkthrough.steps.map((step) => {
                  const { icon, status } = getStepStatus(step);
                  return (
                    <GalleryItem key={step.id}>
                      <Card isCompact>
                        <CardHeader>
                          <div className="flex items-center gap-2">
                            {icon}
                            <Title headingLevel="h3" className="text-lg">
                              {step.title}
                            </Title>
                          </div>
                        </CardHeader>
                        <CardBody>
                          <Content className="mb-2">{step.description}</Content>
                          <Content className="text-sm text-gray-600">Status: {status}</Content>
                        </CardBody>
                      </Card>
                    </GalleryItem>
                  );
                })}
              </Gallery>
            </div>
          ))}
        </div>
      </DrawerContentBody>
    </DrawerPanelContent>
  );
}
