import * as pathlib from "path";

import { FileSystemTools } from "../src/tools/filesystem";

describe("searchFilesTool", () => {
  it("should handle nested directories correctly", async () => {
    const fsToolsFactory = new FileSystemTools(pathlib.resolve(".", "tests", "test_data", "tools"));

    //TODO (pgaikwad) - do this better
    const tool = fsToolsFactory.all()[0];

    const tc1 = await tool.invoke({
      pattern: "application\\.properties",
    });
    expect(tc1).toBe(pathlib.join("src", "main", "resources", "application.properties"));

    const tc2 = await tool.invoke({
      pattern: "application.properties",
    });
    expect(tc2).toBe(pathlib.join("src", "main", "resources", "application.properties"));

    const tc3 = await tool.invoke({
      pattern: ".*application.*",
    });
    expect(tc3).toBe(pathlib.join("src", "main", "resources", "application.properties"));

    const tc4 = await tool.invoke({
      pattern: ".*.java",
    });
    const e1 = pathlib.join("src", "main", "java", "io", "example", "lib", "A.java");
    const e2 = pathlib.join("src", "main", "java", "io", "example", "utils", "B.java");
    expect(tc4).toBe(`${e1}\n${e2}`);
  });
});
