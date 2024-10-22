import React from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Content,
  Flex,
  FlexItem,
  Divider,
} from "@patternfly/react-core";
import { Change } from "@editor-extensions/shared";

interface SolutionCardProps {
  changes: Change[];
  onViewFix: (change: Change) => void;
}

export const SolutionCard: React.FC<SolutionCardProps> = ({
  changes,
  onViewFix,
}) => (
  <Card>
    <CardHeader>
      <CardTitle>File Changes</CardTitle>
    </CardHeader>
    <CardBody>
      <Flex direction={{ default: "column" }} gap={{ default: "gapMd" }}>
        {changes.map((change, index) => (
          <React.Fragment key={index}>
            <FlexItem>
              <Content component="p">From: {change.original}</Content>
              <Content component="p">To: {change.modified}</Content>
            </FlexItem>
            <FlexItem>
              <Button variant="primary" onClick={() => onViewFix(change)}>
                View Changes
              </Button>
            </FlexItem>
            {index < changes.length - 1 && <Divider />}{" "}
            {/* Add a divider between changes */}
          </React.Fragment>
        ))}
      </Flex>
    </CardBody>
  </Card>
);
