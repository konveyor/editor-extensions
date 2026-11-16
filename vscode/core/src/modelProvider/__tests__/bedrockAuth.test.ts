import * as fs from "fs";
import * as os from "os";
import * as pathlib from "path";
import expect from "expect";
import { createLogger } from "winston";
import { type ChatBedrockConverse } from "@langchain/aws";

import { ModelCreators, resolveBedrockAuth } from "../modelCreator";

describe("resolveBedrockAuth", () => {
  const staticKeys = { AWS_ACCESS_KEY_ID: "AKIAEXAMPLE", AWS_SECRET_ACCESS_KEY: "secret" };
  // Anything taken from provider settings must also ask for request signing,
  // or an inherited Bedrock API key would be used in its place.
  const signed = { authSchemePreference: ["sigv4"] };

  it("returns nothing when no credentials are configured, leaving it to the SDK", () => {
    expect(resolveBedrockAuth({ AWS_DEFAULT_REGION: "us-east-1" }, {})).toEqual({});
  });

  it("uses access keys from provider settings", () => {
    expect(resolveBedrockAuth({ ...staticKeys }, { ...staticKeys })).toEqual({
      credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" },
      ...signed,
    });
  });

  it("passes the session token through with temporary credentials", () => {
    const providerEnv = { ...staticKeys, AWS_SESSION_TOKEN: "token" };
    expect(resolveBedrockAuth({ ...providerEnv }, providerEnv)).toEqual({
      credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret", sessionToken: "token" },
      ...signed,
    });
  });

  it("uses a profile named in provider settings", () => {
    const providerEnv = { AWS_PROFILE: "my-sso" };
    expect(resolveBedrockAuth({ ...providerEnv }, providerEnv)).toEqual({
      profile: "my-sso",
      ...signed,
    });
  });

  it("prefers a profile in provider settings over inherited access keys", () => {
    const providerEnv = { AWS_PROFILE: "my-sso" };
    const env = { AWS_ACCESS_KEY_ID: "AKIAINHERITED", AWS_SECRET_ACCESS_KEY: "s", ...providerEnv };
    expect(resolveBedrockAuth(env, providerEnv)).toEqual({ profile: "my-sso", ...signed });
  });

  it("prefers access keys in provider settings over an inherited profile", () => {
    const env = { AWS_PROFILE: "inherited", ...staticKeys };
    expect(resolveBedrockAuth(env, { ...staticKeys })).toEqual({
      credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" },
      ...signed,
    });
  });

  it("does not attach an inherited session token to access keys from provider settings", () => {
    const env = { AWS_SESSION_TOKEN: "inherited-token", ...staticKeys };
    expect(resolveBedrockAuth(env, { ...staticKeys })).toEqual({
      credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" },
      ...signed,
    });
  });

  it("uses inherited temporary credentials, session token included", () => {
    const env = { ...staticKeys, AWS_SESSION_TOKEN: "inherited-token" };
    expect(resolveBedrockAuth(env, {})).toEqual({
      credentials: {
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "secret",
        sessionToken: "inherited-token",
      },
    });
  });

  it("leaves an inherited profile to the SDK", () => {
    expect(resolveBedrockAuth({ AWS_PROFILE: "inherited" }, {})).toEqual({});
  });

  it("does not override the SDK's auth choice when nothing comes from provider settings", () => {
    const env = { ...staticKeys, AWS_BEARER_TOKEN_BEDROCK: "inherited-api-key" };
    expect(resolveBedrockAuth(env, {}).authSchemePreference).toBeUndefined();
  });

  it("treats empty placeholder values from the sample settings as unset", () => {
    const providerEnv = { AWS_ACCESS_KEY_ID: "", AWS_SECRET_ACCESS_KEY: "", AWS_PROFILE: "my-sso" };
    expect(resolveBedrockAuth({ ...providerEnv }, providerEnv)).toEqual({
      profile: "my-sso",
      ...signed,
    });
  });
});

/**
 * Builds the model the way the extension does and asks the real AWS SDK which
 * credentials the resulting Bedrock client would sign with. Runs against a
 * throwaway shared config holding two fake profiles; nothing reaches AWS.
 */
describe("ChatBedrock credential resolution", () => {
  const logger = createLogger({ silent: true });
  const args = { model: "test-model" };
  let configDir: string;
  let savedEnv: NodeJS.ProcessEnv;

  before(() => {
    configDir = fs.mkdtempSync(pathlib.join(os.tmpdir(), "bedrock-auth-test-"));
    fs.writeFileSync(
      pathlib.join(configDir, "config"),
      "[default]\nregion = us-east-1\n[profile my-sso]\nregion = us-east-1\n",
    );
    fs.writeFileSync(
      pathlib.join(configDir, "credentials"),
      [
        "[default]",
        "aws_access_key_id = AKIADEFAULTPROFILE00",
        "aws_secret_access_key = fake",
        "[my-sso]",
        "aws_access_key_id = AKIANAMEDPROFILE0000",
        "aws_secret_access_key = fake",
        "",
      ].join("\n"),
    );
  });

  after(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    savedEnv = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("AWS_")) {
        delete process.env[key];
      }
    }
    process.env.AWS_CONFIG_FILE = pathlib.join(configDir, "config");
    process.env.AWS_SHARED_CREDENTIALS_FILE = pathlib.join(configDir, "credentials");
    process.env.AWS_EC2_METADATA_DISABLED = "true";
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, savedEnv);
  });

  /** Mirrors getModelProviderFromConfig: the provider block overlays the process environment. */
  const createClient = async (providerEnv: Record<string, string>) => {
    const mergedEnv = { ...(process.env as Record<string, string>), ...providerEnv };
    const model = (await ModelCreators.ChatBedrock(logger, providerEnv).create(
      args,
      mergedEnv,
    )) as ChatBedrockConverse;
    return model.client;
  };
  const resolveCredentials = async (providerEnv: Record<string, string>) =>
    (await createClient(providerEnv)).config.credentials();

  it("resolves the profile named in provider settings", async () => {
    const credentials = await resolveCredentials({
      AWS_PROFILE: "my-sso",
      AWS_DEFAULT_REGION: "us-east-1",
    });
    expect(credentials.accessKeyId).toBe("AKIANAMEDPROFILE0000");
  });

  it("resolves the profile named in provider settings despite inherited access keys", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAINHERITED0000000";
    process.env.AWS_SECRET_ACCESS_KEY = "fake";
    const credentials = await resolveCredentials({
      AWS_PROFILE: "my-sso",
      AWS_DEFAULT_REGION: "us-east-1",
    });
    expect(credentials.accessKeyId).toBe("AKIANAMEDPROFILE0000");
  });

  it("keeps the session token of temporary credentials in provider settings", async () => {
    const credentials = await resolveCredentials({
      AWS_ACCESS_KEY_ID: "ASIATEMPORARYKEY0000",
      AWS_SECRET_ACCESS_KEY: "fake",
      AWS_SESSION_TOKEN: "session-token",
      AWS_DEFAULT_REGION: "us-east-1",
    });
    expect(credentials).toMatchObject({
      accessKeyId: "ASIATEMPORARYKEY0000",
      sessionToken: "session-token",
    });
  });

  it("still falls back to the default profile when nothing is configured", async () => {
    const credentials = await resolveCredentials({ AWS_DEFAULT_REGION: "us-east-1" });
    expect(credentials.accessKeyId).toBe("AKIADEFAULTPROFILE00");
  });

  it("still honors a profile selected through the process environment", async () => {
    process.env.AWS_PROFILE = "my-sso";
    const credentials = await resolveCredentials({ AWS_DEFAULT_REGION: "us-east-1" });
    expect(credentials.accessKeyId).toBe("AKIANAMEDPROFILE0000");
  });

  describe("with a Bedrock API key inherited from the process environment", () => {
    beforeEach(() => {
      process.env.AWS_BEARER_TOKEN_BEDROCK = "inherited-api-key";
    });

    it("signs with the profile named in provider settings instead", async () => {
      const client = await createClient({ AWS_PROFILE: "my-sso", AWS_DEFAULT_REGION: "us-east-1" });
      expect(await client.config.authSchemePreference()).toEqual(["sigv4"]);
    });

    it("signs with the access keys in provider settings instead", async () => {
      const client = await createClient({
        AWS_ACCESS_KEY_ID: "AKIAEXAMPLE000000000",
        AWS_SECRET_ACCESS_KEY: "fake",
        AWS_DEFAULT_REGION: "us-east-1",
      });
      expect(await client.config.authSchemePreference()).toEqual(["sigv4"]);
    });

    it("still uses the API key when provider settings name no credentials", async () => {
      const client = await createClient({ AWS_DEFAULT_REGION: "us-east-1" });
      expect(await client.config.authSchemePreference()).toEqual(["httpBearerAuth"]);
    });
  });
});
