import { posix, win32 } from "path";

import { fileUriToPath, toPosixRelative } from "../src/utils";

describe("fileUriToPath", () => {
  (process.platform !== "win32" ? it : it.skip)(
    "should correctly return linux/darwin paths",
    () => {
      const tc1 = "file:///root/coolstore/src/main/webapp/WEB-INF/web.xml";
      const tc2 = "/root/coolstore/src/main/webapp/WEB-INF/web.xml";

      expect(fileUriToPath(tc1)).toBe("/root/coolstore/src/main/webapp/WEB-INF/web.xml");
      expect(fileUriToPath(tc2)).toBe("/root/coolstore/src/main/webapp/WEB-INF/web.xml");
    },
  );

  (process.platform === "win32" ? it : it.skip)("should correctly return windows paths", () => {
    const tc1 = "file:///C:\\root\\coolstore\\src\\main\\webapp\\WEB-INF\\web.xml";
    const tc2 = "/C:\\root\\coolstore\\src\\main\\webapp\\WEB-INF\\web.xml";

    expect(fileUriToPath(tc1)).toBe("C:\\root\\coolstore\\src\\main\\webapp\\WEB-INF\\web.xml");
    expect(fileUriToPath(tc2)).toBe("C:\\root\\coolstore\\src\\main\\webapp\\WEB-INF\\web.xml");
  });
});

describe("toPosixRelative (issue #1425)", () => {
  it("produces forward-slash output on POSIX", () => {
    expect(
      toPosixRelative("/work/coolstore", "/work/coolstore/src/main/java/Foo.java", posix),
    ).toBe("src/main/java/Foo.java");
  });

  it("produces forward-slash output on Windows", () => {
    expect(
      toPosixRelative(
        "C:\\work\\coolstore",
        "C:\\work\\coolstore\\src\\main\\java\\Foo.java",
        win32,
      ),
    ).toBe("src/main/java/Foo.java");
  });
});
