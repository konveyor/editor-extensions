import React from "react";
import { Content, CodeBlock, CodeBlockCode } from "@patternfly/react-core";
import { Incident } from "@editor-extensions/shared";

interface CodePreviewProps {
  incident: Incident;
}

export function CodePreview({ incident }: CodePreviewProps) {
  return (
    <div>
      <Content component="p">Line {incident.lineNumber}</Content>
      <CodeBlock>
        <CodeBlockCode>{incident.codeSnip}</CodeBlockCode>
      </CodeBlock>
      <Content component="blockquote" className="pf-v5-u-color-200">
        {incident.message}
      </Content>
    </div>
  );
}
