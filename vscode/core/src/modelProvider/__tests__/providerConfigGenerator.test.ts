import expect from "expect";
import { parse } from "yaml";

import {
  extractProviderSettings,
  generateProviderSettingsYaml,
  langchainProviderToUiId,
} from "../providerConfigGenerator";
import { ModelCreators } from "../modelCreator";
import { createLogger } from "winston";

function generate(provider: string, model: string, creds?: Record<string, string>) {
  return parse(generateProviderSettingsYaml(provider, model, creds)) as {
    active: {
      provider: string;
      args: Record<string, unknown>;
      environment?: Record<string, string>;
    };
  };
}

describe("generateProviderSettingsYaml", () => {
  it("writes env vars and model for a simple provider", () => {
    const doc = generate("openai", "gpt-4o", { OPENAI_API_KEY: "sk-test" });
    expect(doc.active.provider).toBe("ChatOpenAI");
    expect(doc.active.args).toEqual({ model: "gpt-4o" });
    expect(doc.active.environment).toEqual({ OPENAI_API_KEY: "sk-test" });
  });

  it("maps Azure deployment settings into LangChain args and env", () => {
    const doc = generate("azure", "gpt-4o", {
      AZURE_OPENAI_API_KEY: "key",
      AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
      AZURE_OPENAI_DEPLOYMENT_NAME: "my-deployment",
      AZURE_OPENAI_API_VERSION: "2024-10-21",
    });
    expect(doc.active.provider).toBe("AzureChatOpenAI");
    expect(doc.active.args).toEqual({
      model: "gpt-4o",
      azureOpenAIEndpoint: "https://example.openai.azure.com",
      azureOpenAIApiDeploymentName: "my-deployment",
      azureOpenAIApiVersion: "2024-10-21",
    });
    // Same keys the Goose/OpenCode Azure providers read from the spawn env
    expect(doc.active.environment).toEqual({
      AZURE_OPENAI_API_KEY: "key",
      AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
      AZURE_OPENAI_DEPLOYMENT_NAME: "my-deployment",
      AZURE_OPENAI_API_VERSION: "2024-10-21",
    });

    // The generated config must satisfy the direct client's validator
    const creator = ModelCreators.AzureChatOpenAI(createLogger({ silent: true }));
    expect(() =>
      creator.validate(
        { ...creator.defaultArgs(), ...doc.active.args },
        doc.active.environment ?? {},
      ),
    ).not.toThrow();
  });

  it("rejects an Azure config that is missing required settings", () => {
    expect(() =>
      generateProviderSettingsYaml("azure", "gpt-4o", { AZURE_OPENAI_API_KEY: "key" }),
    ).toThrow(/AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT_NAME, AZURE_OPENAI_API_VERSION/);
  });

  it("rejects unknown providers", () => {
    expect(() => generateProviderSettingsYaml("nope", "m")).toThrow(/Unknown provider/);
  });

  it("round-trips provider ids through langchainProviderToUiId", () => {
    expect(langchainProviderToUiId("AzureChatOpenAI")).toBe("azure");
    expect(langchainProviderToUiId("ChatOpenAI")).toBe("openai");
    expect(
      langchainProviderToUiId("ChatOpenAI", {
        configuration: { baseURL: "https://api.groq.com/openai/v1" },
      }),
    ).toBe("groq");
  });
});

describe("extractProviderSettings", () => {
  it("recovers credentials a user wrote into the yaml by hand", () => {
    const { credentials, environment } = extractProviderSettings(`
active:
  provider: ChatOpenAI
  environment:
    OPENAI_API_KEY: sk-by-hand
  args:
    model: gpt-4o
`);
    expect(credentials).toEqual({ OPENAI_API_KEY: "sk-by-hand" });
    expect(environment).toEqual({});
  });

  it("maps yaml env keys back to the active provider's UI keys", () => {
    const groq = extractProviderSettings(
      generateProviderSettingsYaml("groq", "llama3", {
        GROQ_API_KEY: "gsk-1",
      }),
    );
    expect(groq.credentials).toEqual({ GROQ_API_KEY: "gsk-1" });

    const aws = extractProviderSettings(`
active:
  provider: ChatBedrock
  environment:
    AWS_ACCESS_KEY_ID: id
    AWS_SECRET_ACCESS_KEY: secret
    AWS_DEFAULT_REGION: us-east-1
  args:
    model: anthropic.claude-3
`);
    expect(aws.credentials).toEqual({
      AWS_ACCESS_KEY_ID: "id",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_REGION: "us-east-1",
    });
  });

  it("recovers Azure settings stored as LangChain args", () => {
    const creds = {
      AZURE_OPENAI_API_KEY: "key",
      AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
      AZURE_OPENAI_DEPLOYMENT_NAME: "my-deployment",
      AZURE_OPENAI_API_VERSION: "2024-10-21",
    };
    const { credentials } = extractProviderSettings(
      generateProviderSettingsYaml("azure", "gpt-4o", creds),
    );
    expect(credentials).toEqual(creds);
  });

  it("keeps proxy settings and unknown env keys out of the credentials", () => {
    const { credentials, environment } = extractProviderSettings(`
environment:
  HTTPS_PROXY: http://proxy:3128
  CA_BUNDLE: /etc/ca.pem
active:
  provider: ChatOpenAI
  environment:
    OPENAI_API_KEY: sk-1
    OPENAI_ORG: org-1
  args:
    model: gpt-4o
`);
    expect(credentials).toEqual({ OPENAI_API_KEY: "sk-1" });
    expect(environment).toEqual({
      HTTPS_PROXY: "http://proxy:3128",
      CA_BUNDLE: "/etc/ca.pem",
      OPENAI_ORG: "org-1",
    });
  });

  it("carries the preserved environment through a regenerated file", () => {
    const original = `
environment:
  HTTPS_PROXY: http://proxy:3128
active:
  provider: ChatOpenAI
  environment:
    OPENAI_API_KEY: sk-by-hand
  args:
    model: gpt-4o
`;
    const existing = extractProviderSettings(original);
    // Model-only change from the chat UI: no credentials in the payload.
    const regenerated = parse(
      generateProviderSettingsYaml("openai", "gpt-4.1", existing.credentials, {
        baseEnvironment: existing.environment,
      }),
    ) as { environment: Record<string, string>; active: Record<string, any> };
    expect(regenerated.environment).toEqual({ HTTPS_PROXY: "http://proxy:3128" });
    expect(regenerated.active.environment).toEqual({ OPENAI_API_KEY: "sk-by-hand" });
    expect(regenerated.active.args.model).toBe("gpt-4.1");
  });

  it("treats a missing, empty or malformed file as contributing nothing", () => {
    for (const content of ["", "- not: a mapping", "active: [1, 2]", "{{{"]) {
      expect(extractProviderSettings(content)).toEqual({ credentials: {}, environment: {} });
    }
  });
});
