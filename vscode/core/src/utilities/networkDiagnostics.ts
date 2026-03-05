/**
 * Network error classification and diagnostic logging utilities.
 *
 * Helps triage connection issues in restricted customer environments by
 * categorizing errors (TLS, DNS, auth, etc.) and providing actionable suggestions.
 */

export enum NetworkErrorCategory {
  TLS_CERTIFICATE = "TLS_CERTIFICATE",
  DNS_RESOLUTION = "DNS_RESOLUTION",
  CONNECTION = "CONNECTION",
  TIMEOUT = "TIMEOUT",
  AUTHENTICATION = "AUTHENTICATION",
  AUTHORIZATION = "AUTHORIZATION",
  PROXY = "PROXY",
  SERVER_ERROR = "SERVER_ERROR",
  RESPONSE_FORMAT = "RESPONSE_FORMAT",
  UNKNOWN = "UNKNOWN",
}

export interface ClassifiedError {
  category: NetworkErrorCategory;
  summary: string;
  suggestion: string;
}

const TLS_ERROR_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "ERR_TLS_HANDSHAKE_TIMEOUT",
  "CERT_NOT_YET_VALID",
  "CERT_REJECTED",
  "CERT_UNTRUSTED",
]);

const DNS_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);

const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ECONNABORTED",
  "EPIPE",
]);

const TIMEOUT_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/**
 * Extract error code from an error, traversing the cause chain.
 * Undici wraps network errors as `TypeError: fetch failed` with the
 * real error code in `error.cause.code`.
 */
function extractErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const err = error as Record<string, any>;

  // Check direct code
  if (typeof err.code === "string") {
    return err.code;
  }

  // Traverse cause chain (undici pattern: TypeError -> cause with code)
  if (err.cause && typeof err.cause === "object") {
    return extractErrorCode(err.cause);
  }

  return undefined;
}

/**
 * Extract error message from an error, traversing the cause chain for more detail.
 */
function extractErrorMessage(error: unknown): string {
  if (!error) {
    return "Unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    // Include cause message for more context
    const causeMsg = error.cause instanceof Error ? ` (caused by: ${error.cause.message})` : "";
    return `${error.message}${causeMsg}`;
  }
  return String(error);
}

/**
 * Classify a network/fetch error into an actionable category.
 * Traverses the error cause chain to find the root cause code.
 */
export function classifyNetworkError(error: unknown): ClassifiedError {
  const code = extractErrorCode(error);
  const message = extractErrorMessage(error);

  // Check error code against known categories
  if (code) {
    if (TLS_ERROR_CODES.has(code)) {
      return {
        category: NetworkErrorCategory.TLS_CERTIFICATE,
        summary: `SSL/TLS certificate error (${code})`,
        suggestion:
          "Check your certificate configuration. For self-signed certificates, configure a custom CA bundle or enable 'Allow Insecure' in Hub settings.",
      };
    }

    if (DNS_ERROR_CODES.has(code)) {
      return {
        category: NetworkErrorCategory.DNS_RESOLUTION,
        summary: `DNS resolution failed (${code})`,
        suggestion:
          "Cannot resolve the server hostname. Check the URL for typos, verify DNS settings, and ensure the server is reachable from this network.",
      };
    }

    if (CONNECTION_ERROR_CODES.has(code)) {
      return {
        category: NetworkErrorCategory.CONNECTION,
        summary: `Connection failed (${code})`,
        suggestion:
          "Cannot connect to the server. Verify the URL and port are correct, check firewall rules, and ensure the server is running.",
      };
    }

    if (TIMEOUT_ERROR_CODES.has(code)) {
      return {
        category: NetworkErrorCategory.TIMEOUT,
        summary: `Connection timed out (${code})`,
        suggestion:
          "Request timed out. Check your network connection, proxy settings, and whether the server is responsive.",
      };
    }
  }

  // Check for AbortError (fetch timeout via AbortController)
  if (error instanceof Error && error.name === "AbortError") {
    return {
      category: NetworkErrorCategory.TIMEOUT,
      summary: "Request aborted (timeout)",
      suggestion:
        "Request timed out. Check your network connection, proxy settings, and whether the server is responsive.",
    };
  }

  // Check message patterns as fallback
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("certificate") ||
    lowerMessage.includes("ssl") ||
    lowerMessage.includes("tls")
  ) {
    return {
      category: NetworkErrorCategory.TLS_CERTIFICATE,
      summary: `SSL/TLS error: ${message}`,
      suggestion:
        "Check your certificate configuration. For self-signed certificates, configure a custom CA bundle or enable 'Allow Insecure' in Hub settings.",
    };
  }

  return {
    category: NetworkErrorCategory.UNKNOWN,
    summary: message,
    suggestion: "Check your network connection, URL, credentials, and proxy settings.",
  };
}

/**
 * Classify an HTTP status code into an actionable category.
 */
export function classifyHttpStatus(status: number, statusText: string): ClassifiedError {
  if (status === 401) {
    return {
      category: NetworkErrorCategory.AUTHENTICATION,
      summary: `Authentication failed (401 ${statusText})`,
      suggestion:
        "Check your username and password. The credentials may be incorrect or the account may be locked.",
    };
  }

  if (status === 403) {
    return {
      category: NetworkErrorCategory.AUTHORIZATION,
      summary: `Access forbidden (403 ${statusText})`,
      suggestion:
        "Authentication succeeded but access is denied. Check that your account has the necessary permissions.",
    };
  }

  if (status === 407) {
    return {
      category: NetworkErrorCategory.PROXY,
      summary: `Proxy authentication required (407 ${statusText})`,
      suggestion:
        "A proxy server requires authentication. Check your proxy settings and credentials.",
    };
  }

  if (status >= 500) {
    return {
      category: NetworkErrorCategory.SERVER_ERROR,
      summary: `Server error (${status} ${statusText})`,
      suggestion:
        "The server encountered an internal error. This is typically a server-side issue - try again later or contact your administrator.",
    };
  }

  return {
    category: NetworkErrorCategory.UNKNOWN,
    summary: `HTTP error (${status} ${statusText})`,
    suggestion: "Check your URL, credentials, and network connection.",
  };
}

/**
 * Sanitize a URL for logging by removing query parameters and credentials.
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    // If URL parsing fails, do basic sanitization
    // Strip userinfo, query strings, and fragments
    return url
      .replace(/\/\/[^/@\s]+@/, "//")
      .replace(/\?.*$/, "")
      .replace(/#.*$/, "");
  }
}
