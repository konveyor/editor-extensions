/**
 * Health check for network configuration (HTTP/2, proxies, certificates)
 */

import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";
import * as vscode from "vscode";
import { CheckResultBuilder, withErrorHandling, formatDetails } from "../helpers";
import { EXTENSION_NAME } from "../../utilities/constants";

const PROXY_VARS = [
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "https_proxy",
  "http_proxy",
  "NO_PROXY",
  "no_proxy",
];
const CERT_VARS = [
  "CA_BUNDLE",
  "AWS_CA_BUNDLE",
  "PROVIDER_ENV_CA_BUNDLE",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "ALLOW_INSECURE",
];

function collectEnvVars(varNames: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const varName of varNames) {
    const value = process.env[varName];
    if (value) {
      result[varName] = value;
    }
  }
  return result;
}

function formatProxyConfig(proxyConfig: Record<string, string>): string {
  if (Object.keys(proxyConfig).length === 0) {
    return "Proxy Configuration: None detected";
  }

  const entries = Object.entries(proxyConfig).map(([key, value]) => {
    const redacted = value.replace(/\/\/([^:]+):([^@]+)@/, "//<username>:<redacted>@");
    return `  ${key}: ${redacted}`;
  });
  return `Proxy Configuration:\n${entries.join("\n")}`;
}

function formatCertConfig(certConfig: Record<string, string>): string {
  if (Object.keys(certConfig).length === 0) {
    return "Certificate Configuration: Using system defaults";
  }

  const entries = Object.entries(certConfig).map(([key, value]) => `  ${key}: ${value}`);
  return `Certificate Configuration:\n${entries.join("\n")}`;
}

function collectWarnings(
  httpProtocol: string,
  proxyConfig: Record<string, string>,
  certConfig: Record<string, string>,
): string[] {
  const warnings: string[] = [];

  if (httpProtocol === "2.0" || httpProtocol === "http2") {
    warnings.push(
      "HTTP/2 is enabled. This may be blocked by corporate firewalls. If experiencing ECONNRESET errors, switch to HTTP/1.1",
    );
  }

  if (Object.keys(proxyConfig).length > 0 && httpProtocol === "2.0") {
    warnings.push(
      "HTTP/2 with proxy may not be supported by all providers. Consider using HTTP/1.1 when behind a proxy.",
    );
  }

  if (certConfig.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    warnings.push(
      "TLS certificate validation is DISABLED. This is insecure and should only be used for testing.",
    );
  }

  return warnings;
}

export const networkConfigCheck: HealthCheckModule = {
  id: "network-config",
  name: "Network Configuration",
  description: "Checks network configuration including HTTP protocol, proxy, and certificates",
  platforms: ["all"],
  enabled: true,
  extensionSource: "core",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { logger } = context;
    const builder = new CheckResultBuilder("Network Configuration");

    return withErrorHandling("Network Configuration", logger, async () => {
      const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
      const httpProtocol = config.get<string>("genai.httpProtocol") || "http1";

      const proxyConfig = collectEnvVars(PROXY_VARS);
      const certConfig = collectEnvVars(CERT_VARS);

      const warnings = collectWarnings(httpProtocol, proxyConfig, certConfig);

      const detailsSections = [
        `HTTP Protocol: ${httpProtocol}`,
        formatProxyConfig(proxyConfig),
        formatCertConfig(certConfig),
        warnings.length > 0
          ? `Warnings:\n${warnings.map((w) => `  - ${w}`).join("\n")}`
          : undefined,
      ];

      const details = formatDetails(...detailsSections);

      if (warnings.length > 0) {
        return builder.warning(
          `Network configuration has ${warnings.length} warning(s)`,
          details,
          "Review warnings and adjust configuration if experiencing connection issues.",
        );
      }

      return builder.pass("Network configuration detected", details);
    });
  },
};
