import expect from "expect";
import { parse } from "yaml";

import { generateProviderSettingsYaml, langchainProviderToUiId } from "../providerConfigGenerator";
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
