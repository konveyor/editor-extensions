import React from "react";
import { CardTitle, Flex, FlexItem, Label } from "@patternfly/react-core";

interface ModifiedFileHeaderProps {
  isNew: boolean;
  fileName: string;
  timestamp?: string;
  readOnly?: boolean;
}

export const ModifiedFileHeader: React.FC<ModifiedFileHeaderProps> = ({
  isNew,
  fileName,
  timestamp,
  readOnly = false,
}) => {
  const formattedTime = timestamp
    ? new Date(timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "";

  return (
    <CardTitle>
      <Flex>
        <FlexItem grow={{ default: "grow" }}>
          {isNew ? "Created file:" : "Modified file:"} <strong>{fileName}</strong>
          {readOnly && (
            <Label color="blue" style={{ marginLeft: "8px" }}>
              For Context
            </Label>
          )}
        </FlexItem>
        {formattedTime && <FlexItem className="modified-file-timestamp">{formattedTime}</FlexItem>}
      </Flex>
    </CardTitle>
  );
};

export default ModifiedFileHeader;
