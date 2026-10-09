import expect from "expect";
import { buildOpencodeConfigContent, getAgentLaunchEnv } from "../agentConfigReader";

describe("buildOpencodeConfigContent", () => {
  it("selects the model as <provider>/<model> and declares it under the provider", () => {
    const content = buildOpencodeConfigContent("openai", "gpt-4o");
    expect(JSON.parse(content!)).toEqual({
      model: "openai/gpt-4o",
      provider: { openai: { models: { "gpt-4o": { name: "gpt-4o" } } } },
    });
  });

  it("maps UI provider ids to OpenCode provider ids", () => {
    const content = buildOpencodeConfigContent("aws_bedrock", "anthropic.claude-3");
    expect(JSON.parse(content!).model).toBe("amazon-bedrock/anthropic.claude-3");
  });

  it("declares Ollama as an OpenAI-compatible provider", () => {
    const parsed = JSON.parse(buildOpencodeConfigContent("ollama", "llama3")!);
    expect(parsed.model).toBe("ollama/llama3");
    expect(parsed.provider.ollama).toMatchObject({
      npm: "@ai-sdk/openai-compatible",
      options: { baseURL: "http://localhost:11434/v1" },
      models: { llama3: { name: "llama3" } },
    });
  });

  it("returns undefined without a provider or model", () => {
    expect(buildOpencodeConfigContent("", "gpt-4o")).toBeUndefined();
    expect(buildOpencodeConfigContent("openai", "")).toBeUndefined();
  });
});

describe("getAgentLaunchEnv", () => {
  it("passes OPENCODE_CONFIG_CONTENT for the opencode backend", () => {
    const env = getAgentLaunchEnv("opencode", { provider: "anthropic", model: "claude-sonnet-4" });
    expect(Object.keys(env)).toEqual(["OPENCODE_CONFIG_CONTENT"]);
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT).model).toBe("anthropic/claude-sonnet-4");
  });

  it("is empty for goose (configured through config.yaml) and for an unselected model", () => {
    expect(getAgentLaunchEnv("goose", { provider: "openai", model: "gpt-4o" })).toEqual({});
    expect(getAgentLaunchEnv("opencode", { provider: "", model: "" })).toEqual({});
  });
});
