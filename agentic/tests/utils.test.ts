import { fileUriToPath } from "../src/utils";

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
