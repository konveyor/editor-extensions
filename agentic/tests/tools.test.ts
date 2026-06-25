import * as pathlib from "path";
import { format, Logger } from "winston";
import { Console } from "winston/lib/winston/transports";

import { InMemoryCacheWithRevisions } from "../src/";
import { FileSystemTools } from "../src/tools/filesystem";

describe("searchFilesTool", () => {
  it("should handle nested directories correctly", async () => {
    const fsToolsFactory = new FileSystemTools(
      pathlib.resolve(".", "tests", "test_data", "tools"),
      new InMemoryCacheWithRevisions(true),
      new Logger({
        level: "debug",
        format: format.combine(format.timestamp(), format.json()),
        transports: [new Console()],
      }),
    );

    //TODO (pgaikwad) - do this better
    const tool = fsToolsFactory.all()[0];

    // searchFiles normalizes paths to POSIX separators so output is OS-stable (#1425).
    const appProps = "src/main/resources/application.properties";

    const tc1 = await tool.invoke({
      pattern: "application\\.properties",
    });
    expect(tc1).toBe(appProps);

    const tc2 = await tool.invoke({
      pattern: "application.properties",
    });
    expect(tc2).toBe(appProps);

    const tc3 = await tool.invoke({
      pattern: ".*application.*",
    });
    expect(tc3).toBe(appProps);

    const tc4 = await tool.invoke({
      pattern: ".*.java",
    });
    expect(tc4).toBe("src/main/java/io/example/lib/A.java\nsrc/main/java/io/example/utils/B.java");

    // ISSUE-806: when a model passes a relative path as pattern, it should match
    const tc5 = await tool.invoke({
      pattern: "src/main/java/io/example/lib/A.java",
    });
    expect(tc5).toBe("src/main/java/io/example/lib/A.java");
  });
});
