import { AIMessage } from "@langchain/core/messages";

import { parseAnalysisFixResponse } from "../src/nodes/analysisIssueFix";

describe("test analysis response parsing function", () => {
  it("should parse a partial response correctly", () => {
    const response = `
# Reasoning
I need to add the \`smallrye-reactive-messaging-jms\` extension to the \`pom.xml\` file.
# Updated File
\`\`\`xml
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>my-app</artifactId>
  <version>1.0.0</version>
</project>
\`\`\``;

    const parsed = parseAnalysisFixResponse(new AIMessage({ content: response }));

    expect(parsed.reasoning).toBe(
      "I need to add the `smallrye-reactive-messaging-jms` extension to the `pom.xml` file.",
    );
    expect(parsed.updatedFile).toBe(`<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>my-app</artifactId>
  <version>1.0.0</version>
</project>`);
    expect(parsed.additionalInfo).toBe("");
  });

  it("should parse a full response correctly", () => {
    const response = `
# Reasoning
I need to add the \`smallrye-reactive-messaging-jms\` extension to the \`pom.xml\` file.
# Updated File
\`\`\`xml
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>my-app</artifactId>
  <version>1.0.0</version>
</project>
\`\`\`
# Additional Information
I need to add the \`smallrye-reactive-messaging-jms\` extension to the \`pom.xml\` file.
`;

    const parsed = parseAnalysisFixResponse(new AIMessage({ content: response }));

    expect(parsed.reasoning).toBe(
      "I need to add the `smallrye-reactive-messaging-jms` extension to the `pom.xml` file.",
    );
    expect(parsed.updatedFile).toBe(`<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>my-app</artifactId>
  <version>1.0.0</version>
</project>`);
    expect(parsed.additionalInfo).toBe(
      "I need to add the `smallrye-reactive-messaging-jms` extension to the `pom.xml` file.",
    );
  });

  it("should parse a full response with random newlines correctly (preserving newlines within code blocks)", () => {
    const response = `
# Reasoning


I need to add the \`smallrye-reactive-messaging-jms\` extension to the \`pom.xml\` file.


# Updated File

\`\`\`xml


<project>
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.example</groupId>

  <artifactId>my-app</artifactId>

  <version>1.0.0</version>
</project>



\`\`\`

# Additional Information




I need to add the \`smallrye-reactive-messaging-jms\` extension to the \`pom.xml\` file.
`;

    const parsed = parseAnalysisFixResponse(new AIMessage({ content: response }));

    expect(parsed.reasoning).toBe(
      "I need to add the `smallrye-reactive-messaging-jms` extension to the `pom.xml` file.",
    );
    expect(parsed.updatedFile).toBe(`<project>
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.example</groupId>

  <artifactId>my-app</artifactId>

  <version>1.0.0</version>
</project>`);
    expect(parsed.additionalInfo).toBe(
      "I need to add the `smallrye-reactive-messaging-jms` extension to the `pom.xml` file.",
    );
  });

  it("should parse empty sections correctly", () => {
    const response = `
# Reasoning

# Updated File

\`\`\`xml

\`\`\`

# Additional Information

`;

    const parsed = parseAnalysisFixResponse(new AIMessage({ content: response }));

    expect(parsed.reasoning).toBe("");
    expect(parsed.updatedFile).toBe("");
    expect(parsed.additionalInfo).toBe("");
  });

  it("ISSUE-848: should parse code block correctly when updated file section contains text outside code blocks", () => {
    const response = `
# Reasoning
I need to add the \`smallrye-reactive-messaging-jms\` extension to the \`pom.xml\` file.
# Updated File

This text is not part of the code block.
\`\`\`xml
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>my-app</artifactId>
  <version>1.0.0</version>
</project>
\`\`\`

This text is not part of the code block.

# Additional Information
I need to add the \`smallrye-reactive-messaging-jms\` extension to the \`pom.xml\` file.
`;

    const parsed = parseAnalysisFixResponse(new AIMessage({ content: response }));

    expect(parsed.reasoning).toBe(
      "I need to add the `smallrye-reactive-messaging-jms` extension to the `pom.xml` file.",
    );
    expect(parsed.updatedFile).toBe(`<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>my-app</artifactId>
  <version>1.0.0</version>
</project>`);
    expect(parsed.additionalInfo).toBe(
      "I need to add the `smallrye-reactive-messaging-jms` extension to the `pom.xml` file.",
    );
  });

  it("ISSUE-848: should parse code block correctly when code block itself contains code block separator", () => {
    const response = `
# Reasoning
I need to add the \`smallrye-reactive-messaging-jms\` extension to the \`pom.xml\` file.
# Updated File

This text is not part of the code block.
\`\`\`py
import os

\\\`\\\`\\\`
This is an escaped comment
\\\`\\\`\\\`
def main():
  print("Hello, World!")
\`\`\`

This text is not part of the code block.

# Additional Information
I need to add the \`smallrye-reactive-messaging-jms\` extension to the \`pom.xml\` file.
`;

    const parsed = parseAnalysisFixResponse(new AIMessage({ content: response }));

    expect(parsed.reasoning).toBe(
      "I need to add the `smallrye-reactive-messaging-jms` extension to the `pom.xml` file.",
    );
    expect(parsed.updatedFile).toBe(`import os

\\\`\\\`\\\`
This is an escaped comment
\\\`\\\`\\\`
def main():
  print("Hello, World!")`);
    expect(parsed.additionalInfo).toBe(
      "I need to add the `smallrye-reactive-messaging-jms` extension to the `pom.xml` file.",
    );
  });
});
