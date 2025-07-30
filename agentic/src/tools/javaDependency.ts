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
        version: z.string().describe("Version of the dependency").optional(),
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

        let response: string = `No dependencies found matching given search criteria`;
        const query = [artifactID, groupID, version]
          .filter(Boolean)
          .map((val, idx) => {
            switch (idx) {
              case 0:
                return `a:${val}`;
              case 1:
                return `g:${val}`;
              case 2:
                return `v:${val}`;
              default:
                return `${val}`;
            }
          })
          .join(" AND ");
        const url = `https://search.maven.org/solrsearch/select?q=${query}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        try {
          const fetchOptions: RequestInit = {
            signal: controller.signal,
          };
          const resp = await fetch(url, fetchOptions);
          if (resp.status !== 200) {
            response = `Maven Central API returned status code: ${resp.status}`;
            this.logger.error(response);
          } else {
            const output = (await resp.json()) as MavenApiResponse;
            const docs = output?.response?.docs.filter(Boolean);

            if (docs && docs.length) {
              const depToString = (dep: MavenResponseDoc) =>
                `ArtifactID: ${dep.a}, GroupID: ${dep.g}${dep.latestVersion ? `, LatestVersion: ${dep.latestVersion}` : ``}`;

              if (docs.length > 1) {
                response = docs.map((d) => depToString(d)).join("\n - ");
              } else if (docs.length === 1) {
                response = depToString(docs[0]);
              }
            }
          }
        } catch (error: any) {
          if (error.name === "AbortError") {
            this.logger.error("Request to Maven Central timed out.");
          } else {
            this.logger.error("Error fetching from Maven Central:", error);
          }
          response = `Encountered error retrieving dependencies: ${String(error)}`;
        } finally {
          clearTimeout(timeoutId);
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
}
