import React from "react";
import {
  Card,
  CardHeader,
  CardBody,
  CardTitle,
  Flex,
  FlexItem,
  Content,
  Label,
  Divider,
} from "@patternfly/react-core";
import { Incident, Violation } from "@editor-extensions/shared";

interface ViolationCardProps {
  incident: Incident | null;
  violation: Violation | null;
}

export const ViolationCard: React.FC<ViolationCardProps> = ({
  incident,
  violation,
}) => {
  if (!violation) {
    // Handle the case where violation data is not available
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Violation Data</CardTitle>
        </CardHeader>
        <CardBody>
          <Content>No violation details available at the moment.</Content>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{violation.description}</CardTitle>
      </CardHeader>
      <CardBody>
        <Flex direction={{ default: "column" }} gap={{ default: "gapMd" }}>
          {/* Display selected incident details, if available */}
          {incident && (
            <>
              <FlexItem>
                <Content>
                  <strong>Selected Incident:</strong>
                </Content>
                <Content>
                  <strong>File:</strong> {incident.uri.split("/").pop()}
                </Content>
                <Content>
                  <strong>Line:</strong> {incident.lineNumber}
                </Content>
                {/* <Content>
                  <strong>Message:</strong> {incident.message}
                </Content> */}
                {/* <Content>
                  <strong>Code Snippet:</strong>
                </Content>
                <Content
                  component="pre"
                  style={{ backgroundColor: "#f5f5f5", padding: "10px" }}
                >
                  {incident.codeSnip}
                </Content> */}
                <Label color="blue">{incident.severity || "Low"}</Label>
              </FlexItem>
              <Divider />
            </>
          )}
        </Flex>
      </CardBody>
    </Card>
  );
};

export default ViolationCard;
