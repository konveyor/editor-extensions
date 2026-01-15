export type HubConfiguration = {
  enabled: boolean;
  url: string;
  skipSSL: boolean;
  auth?: HubConfigurationAuth;
  solutionServerEnabled: boolean;
  profileSyncEnabled: boolean;
};

export type HubConfigurationAuth = {
  enabled: boolean;
  username: string;
  password: string;
};
