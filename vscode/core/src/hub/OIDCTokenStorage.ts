/**
 * OIDC Token Storage for Konveyor Hub.
 *
 * Wraps VS Code's SecretStorage API to persist OIDC tokens (access token,
 * refresh token, expiry) encrypted in the user's credential store.
 *
 * Tokens are keyed by a hash of the hub URL so switching between hub
 * instances doesn't clobber stored credentials.
 *
 * @module OIDCTokenStorage
 */
import * as vscode from "vscode";
import { createHash } from "crypto";
import type { OIDCTokens } from "./OIDCAuthCodeFlow";

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = "konveyor.oidc.tokens";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Serialized token format in SecretStorage. */
interface StoredTokenData {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: number | null;
  storedAt: number; // Unix ms — when tokens were stored
}

// ─── Main Class ──────────────────────────────────────────────────────────────

/**
 * Manages OIDC token persistence using VS Code's SecretStorage.
 *
 * Tokens are stored encrypted and survive VS Code restarts.
 * Each hub URL gets its own storage key (hashed).
 */
export class OIDCTokenStorage {
  private readonly secretStorage: vscode.SecretStorage;
  private readonly storageKey: string;

  /**
   * @param secretStorage VS Code SecretStorage instance (from ExtensionContext.secrets)
   * @param hubUrl        The hub URL to associate tokens with
   */
  constructor(secretStorage: vscode.SecretStorage, hubUrl: string) {
    this.secretStorage = secretStorage;
    this.storageKey = OIDCTokenStorage.buildStorageKey(hubUrl);
  }

  /**
   * Build a deterministic storage key for a given hub URL.
   * Uses SHA-256 hash of the normalized URL.
   */
  private static buildStorageKey(hubUrl: string): string {
    const url = new URL(hubUrl.replace(/\/$/, ""));
    url.hostname = url.hostname.toLowerCase();
    const hash = createHash("sha256").update(url.toString()).digest("hex").substring(0, 16);
    return `${STORAGE_KEY_PREFIX}.${hash}`;
  }

  /**
   * Store OIDC tokens in SecretStorage.
   *
   * @param tokens The token set to persist.
   * @throws If SecretStorage write fails (e.g., keyring unavailable).
   */
  public async store(tokens: OIDCTokens): Promise<void> {
    const data: StoredTokenData = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      expiresAt: tokens.expiresAt,
      storedAt: Date.now(),
    };

    const serialized = JSON.stringify(data);

    // Use a timeout to avoid hanging if keyring is unresponsive
    const storePromise = this.secretStorage.store(this.storageKey, serialized);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("OIDC token storage timeout (5s)")), 5000),
    );

    await Promise.race([storePromise, timeoutPromise]);
  }

  /**
   * Retrieve stored OIDC tokens.
   *
   * @returns The stored tokens, or null if none exist.
   */
  public async retrieve(): Promise<OIDCTokens | null> {
    const serialized = await this.secretStorage.get(this.storageKey);
    if (!serialized) {
      return null;
    }

    try {
      const data: StoredTokenData = JSON.parse(serialized);

      // Validate structure
      if (!data.accessToken || typeof data.accessToken !== "string") {
        await this.clear();
        return null;
      }

      return {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? null,
        idToken: data.idToken ?? null,
        expiresAt: data.expiresAt ?? null,
      };
    } catch {
      // Corrupted data — clear it
      await this.clear();
      return null;
    }
  }

  /**
   * Clear stored tokens (for logout or hub URL change).
   */
  public async clear(): Promise<void> {
    await this.secretStorage.delete(this.storageKey);
  }

  /**
   * Check if tokens are stored (without reading them).
   */
  public async hasTokens(): Promise<boolean> {
    const stored = await this.secretStorage.get(this.storageKey);
    return !!stored;
  }

  /**
   * Static helper to clear all OIDC tokens for a specific hub URL.
   * Useful when the user changes hub URL in settings.
   */
  public static async clearForHub(
    secretStorage: vscode.SecretStorage,
    hubUrl: string,
  ): Promise<void> {
    const key = OIDCTokenStorage.buildStorageKey(hubUrl);
    await secretStorage.delete(key);
  }
}
