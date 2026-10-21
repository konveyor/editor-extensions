/**
 * What both cluster commands need first: a Hub API client from the IDE's Hub
 * connection, and the Hub application that matches the open workspace.
 */
import * as vscode from "vscode";
import type { Logger } from "winston";
import type { ExtensionState } from "../extensionState";
import type { HubApplication } from "../clients/ProfileSyncClient";
import { getRepositoryInfo, type RepositoryInfo } from "../utilities/git";
import { HubAgentApi } from "./hubAgentApi";

export interface HubContext {
  api: HubAgentApi;
  hubUrl: string;
  application: HubApplication;
  repoInfo: RepositoryInfo;
}

/** Null (after telling the user why) when there is no Hub or no matching application. */
export async function resolveHubContext(
  state: ExtensionState,
  log: Logger,
): Promise<HubContext | null> {
  const hub = state.hubConnectionManager;
  const hubUrl = hub.getHubUrl();
  const profileSync = hub.getProfileSyncClient();
  if (!hubUrl || !profileSync) {
    vscode.window.showWarningMessage(
      "This needs a Hub connection with profile sync. Configure the Hub first.",
    );
    return null;
  }
  const repoInfo = await getRepositoryInfo(state.data.workspaceRoot, log);
  if (!repoInfo) {
    vscode.window.showWarningMessage("The workspace is not a git repository with a remote.");
    return null;
  }
  const application = await profileSync.findApplicationForWorkspace(repoInfo);
  if (!application) {
    vscode.window.showWarningMessage(
      `No Hub application matches this repository (${repoInfo.remoteUrl}). Add it to the Hub inventory first.`,
    );
    return null;
  }
  const api = new HubAgentApi({
    baseUrl: hubUrl,
    bearerToken: hub.getBearerToken(),
    fetchFn: hub.getScopedFetch(),
  });
  return { api, hubUrl, application, repoInfo };
}
