import { z } from "zod";
import * as winston from "winston";
import { DynamicStructuredTool } from "@langchain/core/tools";

import { type FileBasedResponseCache } from "../cache";

interface MavenResponseDoc {
  g: string;
  a: string;
  latestVersion?: string;
}

interface MavenApiResponse {
  response: {
    docs: MavenResponseDoc[];
  };
}

export class JavaDependencyTools {
  private readonly logger: winston.Logger;

  constructor(
    private readonly cache: FileBasedResponseCache<Record<string, any>, string>,
    logger: winston.Logger,
  ) {
    this.logger = logger.child({
      component: "JavaDependencyTools",
    });
  }

  all(): DynamicStructuredTool[] {
    return [this.searchFQDNTool()];
  }

  private searchFQDNTool = (): DynamicStructuredTool => {
    return new DynamicStructuredTool({
      name: "searchFqdn",
      description:
        "Searches maven central repo for fully qualified domain names for Java dependencies",
      schema: z.object({
        artifactID: z.string().describe("Artifact ID of the dependency"),
        groupID: z.string().describe("Group ID of the dependency"),
        version: z
          .string()
          .describe(
            "Version of the dependency (optional). When not specified, latest version will be returned.",
          )
          .optional(),
      }),
      func: async ({
        artifactID,
        groupID,
        version,
      }: {
        artifactID: string;
        groupID: string;
        version: string;
      }) => {
        const cacheKey = {
          artifactID,
          groupID,
          version,
        };
        const cacheSubDir = "searchFqdn";
        const cachedResponse = await this.cache.get(cacheKey, {
          cacheSubDir,
          inputFileExt: ".json",
          outputFileExt: "",
        });
        if (cachedResponse) {
          return cachedResponse;
        }

        const depToString = (dep: MavenResponseDoc) =>
          `ArtifactID: ${dep.a}, GroupID: ${dep.g}${dep.latestVersion ? `, LatestVersion: ${dep.latestVersion}` : ``}`;

        let response: string = `No dependencies found matching given search criteria.`;

        let mavenResponse = await this.queryMavenCentral(groupID, artifactID, version);
        if (typeof mavenResponse !== "string" && !mavenResponse.length && version) {
          // we did not find an exact match for given version, we will try a broader search and get the latest version
          mavenResponse = await this.queryMavenCentral(groupID, artifactID, undefined);
        }
        if (typeof mavenResponse === "string") {
          // we encountered a non recoverable error
          response = mavenResponse;
        } else if (mavenResponse && mavenResponse.length) {
          // we found an exact match for the given groupID and artifactID, and possibly a version
          if (mavenResponse.length > 1) {
            response = mavenResponse.map((d) => depToString(d)).join("\n - ");
          } else if (mavenResponse.length === 1) {
            response = depToString(mavenResponse[0]);
          }
        } else if (mavenResponse && !mavenResponse.length) {
          response = `Invalid GroupID or ArtifactID. Please try a different GroupID and/or ArtifactID.`;
        }
        await this.cache.set(cacheKey, response, {
          cacheSubDir,
          inputFileExt: ".json",
          outputFileExt: "",
        });
        return response;
      },
    });
  };

  private async queryMavenCentral(
    groupID: string,
    artifactID: string,
    version?: string,
  ): Promise<MavenResponseDoc[] | string> {
    let response: MavenResponseDoc[] | string =
      "No dependencies found matching given search criteria. Try a broader search without a version constraint.";
    const terms: string[] = [];
    if (artifactID) {
      terms.push(`a:"${artifactID}"`);
    }
    if (groupID) {
      terms.push(`g:"${groupID}"`);
    }
    if (version) {
      terms.push(`v:"${version}"`);
    }
    const query = terms.join(" AND ");
    const url = `https://search.maven.org/solrsearch/select?q=${query}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const fetchOptions: RequestInit = {
        signal: controller.signal,
      };
      const resp = await fetch(url, fetchOptions);
      if (resp.status !== 200) {
        response = `Maven Central API returned code ${resp.status}: ${await resp.text()}`;
      } else {
        const output = (await resp.json()) as MavenApiResponse;
        const docs = output?.response?.docs.filter(Boolean);
        response = docs;
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        response = "Request to Maven Central timed out.";
      } else {
        response = `Encountered error retrieving dependencies: ${String(error)}`;
      }
    } finally {
      clearTimeout(timeoutId);
    }
    if (typeof response === "string") {
      this.logger.error(response);
    }
    return response;
  }
}
