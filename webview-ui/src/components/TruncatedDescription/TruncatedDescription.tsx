import React, { useState } from "react";
import { Button, Content, ContentVariants } from "@patternfly/react-core";

export function TruncatedDescription({
  shortText,
  fullText,
}: {
  shortText: string;
  fullText: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Content component={ContentVariants.p}>
      {isExpanded ? fullText : shortText}{" "}
      <Button variant="link" isInline onClick={() => setIsExpanded(!isExpanded)}>
        {isExpanded ? "Show less" : "Show more"}
      </Button>
    </Content>
  );
}
