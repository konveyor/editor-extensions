import { test as base } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export type RepoData = Record<
  string,
  {
    repoUrl: string;
    repoName: string;
    branch: string;
    sources: string[];
    targets: string[];
    customRulesFolder?: string;
    issuesCount: number;
    incidentsCount: number;
  }
>;

export const test = base.extend<{
  testRepoData: RepoData;
}>({
  testRepoData: async ({}, use) => {
    try {
      const jsonPath = path.resolve(__dirname, './test-repos.json');
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const data: RepoData = JSON.parse(raw);
      await use(data);
    } catch (error: any) {
      throw new Error(`Failed to load test repository data: ${error.message}`);
    }
  },
});

export { expect } from '@playwright/test';
