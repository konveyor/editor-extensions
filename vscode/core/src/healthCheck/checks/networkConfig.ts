/**
 * Health check for network configuration (HTTP/2, proxies, certificates)
 */

import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";
import * as vscode from "vscode";

export const networkConfigCheck: HealthCheckModule = {
  id: "network-config",
  name: "Network Configuration",
  description: "Checks network configuration including HTTP protocol, proxy, and certificates",
  platforms: ["all"],
  enabled: true,
  extensionSource: "core",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { logger } = context;

    try {
      const config = vscode.workspace.getConfiguration("konveyor");
      const httpProtocol = config.get<string>("genai.httpProtocol") || "http1";

      // Check proxy environment variables
      const proxyVars = [
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "https_proxy",
        "http_proxy",
        "NO_PROXY",
        "no_proxy",
      ];
      const proxyConfig: Record<string, string> = {};
      for (const varName of proxyVars) {
        const value = process.env[varName];
        if (value) {
          proxyConfig[varName] = value;
        }
      }

      // Check certificate environment variables
      const certVars = [
        "CA_BUNDLE",
        "AWS_CA_BUNDLE",
        "PROVIDER_ENV_CA_BUNDLE",
        "NODE_TLS_REJECT_UNAUTHORIZED",
        "ALLOW_INSECURE",
      ];
      const certConfig: Record<string, string> = {};
      for (const varName of certVars) {
        const value = process.env[varName];
        if (value) {
          certConfig[varName] = value;
        }
      }

      let details = `HTTP Protocol: ${httpProtocol}\n`;

      // Proxy information
      if (Object.keys(proxyConfig).length > 0) {
        details += "\nProxy Configuration:\n";
        for (const [key, value] of Object.entries(proxyConfig)) {
          // Redact potential credentials in proxy URLs
          const redactedValue = value.replace(/\/\/([^:]+):([^@]+)@/, "//<username>:<redacted>@");
          details += `  ${key}: ${redactedValue}\n`;
        }
      } else {
        details += "\nProxy Configuration: None detected\n";
      }

      // Certificate information
      if (Object.keys(certConfig).length > 0) {
        details += "\nCertificate Configuration:\n";
        for (const [key, value] of Object.entries(certConfig)) {
          details += `  ${key}: ${value}\n`;
        }
      } else {
        details += "\nCertificate Configuration: Using system defaults\n";
      }

      // Warnings
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

      let message = "Network configuration detected";
      if (warnings.length > 0) {
        message = `Network configuration has ${warnings.length} warning(s)`;
        details += `\nWarnings:\n${warnings.map((w) => `  - ${w}`).join("\n")}`;
      }

      return {
        name: "Network Configuration",
        status: warnings.length > 0 ? "warning" : "pass",
        message,
        details,
        suggestion:
          warnings.length > 0
            ? "Review warnings and adjust configuration if experiencing connection issues."
            : undefined,
      };
    } catch (err) {
      logger.error("Error checking network configuration", err);
      return {
        name: "Network Configuration",
        status: "fail",
        message: "Failed to check network configuration",
        details: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
