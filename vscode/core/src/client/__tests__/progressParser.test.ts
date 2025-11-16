import expect from "expect";
import { ProgressParser, ProgressEvent } from "../progressParser";

describe("ProgressParser", () => {
  describe("Progress Event Parsing", () => {
    it("should parse valid progress events and invoke callback", () => {
      const receivedEvents: ProgressEvent[] = [];
      const parser = new ProgressParser((event) => {
        receivedEvents.push(event);
      });

      const progressEvent = {
        timestamp: "2024-01-01T00:00:00Z",
        stage: "rule_execution",
        current: 10,
        total: 50,
        percent: 20,
      };

      parser.feed(JSON.stringify(progressEvent) + "\n");

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0]).toMatchObject(progressEvent);
    });

    it("should parse multiple progress events from buffer", () => {
      const receivedEvents: ProgressEvent[] = [];
      const parser = new ProgressParser((event) => {
        receivedEvents.push(event);
      });

      const event1 = {
        timestamp: "2024-01-01T00:00:00Z",
        stage: "init",
      };
      const event2 = {
        timestamp: "2024-01-01T00:00:01Z",
        stage: "rule_parsing",
        total: 56,
      };

      parser.feed(JSON.stringify(event1) + "\n" + JSON.stringify(event2) + "\n");

      expect(receivedEvents.length).toBe(2);
      expect(receivedEvents[0].stage).toBe("init");
      expect(receivedEvents[1].stage).toBe("rule_parsing");
    });

    it("should handle progress events with message and metadata", () => {
      const receivedEvents: ProgressEvent[] = [];
      const parser = new ProgressParser((event) => {
        receivedEvents.push(event);
      });

      const progressEvent = {
        timestamp: "2024-01-01T00:00:00Z",
        stage: "rule_execution",
        message: "java-transaction-00001",
        current: 49,
        total: 56,
        metadata: {
          rule_id: "java-transaction-00001",
          additional_info: "test",
        },
      };

      parser.feed(JSON.stringify(progressEvent) + "\n");

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].message).toBe("java-transaction-00001");
      expect(receivedEvents[0].metadata?.rule_id).toBe("java-transaction-00001");
    });

    it("should handle all valid progress stages", () => {
      const receivedEvents: ProgressEvent[] = [];
      const parser = new ProgressParser((event) => {
        receivedEvents.push(event);
      });

      const stages = [
        "init",
        "provider_init",
        "rule_parsing",
        "rule_execution",
        "dependency_analysis",
        "complete",
      ];

      stages.forEach((stage) => {
        const event = {
          timestamp: "2024-01-01T00:00:00Z",
          stage,
        };
        parser.feed(JSON.stringify(event) + "\n");
      });

      expect(receivedEvents.length).toBe(6);
      stages.forEach((stage, index) => {
        expect(receivedEvents[index].stage).toBe(stage);
      });
    });
  });

  describe("Non-Progress JSON Filtering", () => {
    it("should skip non-progress JSON and not call non-progress callback", () => {
      const receivedEvents: ProgressEvent[] = [];
      const nonProgressLines: string[] = [];

      const parser = new ProgressParser(
        (event) => {
          receivedEvents.push(event);
        },
        (line) => {
          nonProgressLines.push(line);
        },
      );

      const nonProgressJSON = {
        type: 1,
        ctime: 1763259204893,
        mtime: 1763259204893,
        size: 0,
      };

      parser.feed(JSON.stringify(nonProgressJSON) + "\n");

      // Non-progress JSON should be filtered out completely
      expect(receivedEvents.length).toBe(0);
      expect(nonProgressLines.length).toBe(0);
    });

    it("should call non-progress callback for non-JSON lines", () => {
      const receivedEvents: ProgressEvent[] = [];
      const nonProgressLines: string[] = [];

      const parser = new ProgressParser(
        (event) => {
          receivedEvents.push(event);
        },
        (line) => {
          nonProgressLines.push(line);
        },
      );

      parser.feed("ERROR: Something went wrong\n");
      parser.feed("WARN: Potential issue detected\n");

      expect(receivedEvents.length).toBe(0);
      expect(nonProgressLines.length).toBe(2);
      expect(nonProgressLines[0]).toBe("ERROR: Something went wrong");
      expect(nonProgressLines[1]).toBe("WARN: Potential issue detected");
    });

    it("should handle mixed progress events, non-progress JSON, and error messages", () => {
      const receivedEvents: ProgressEvent[] = [];
      const nonProgressLines: string[] = [];

      const parser = new ProgressParser(
        (event) => {
          receivedEvents.push(event);
        },
        (line) => {
          nonProgressLines.push(line);
        },
      );

      const progressEvent = {
        timestamp: "2024-01-01T00:00:00Z",
        stage: "rule_execution",
        current: 1,
        total: 10,
      };

      const nonProgressJSON = { type: 1, data: "some data" };

      // Feed mixed content
      parser.feed(JSON.stringify(progressEvent) + "\n");
      parser.feed("ERROR: File not found\n");
      parser.feed(JSON.stringify(nonProgressJSON) + "\n");
      parser.feed("WARN: Deprecated API\n");

      // Should have 1 progress event and 2 error messages
      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].stage).toBe("rule_execution");
      expect(nonProgressLines.length).toBe(2);
      expect(nonProgressLines[0]).toBe("ERROR: File not found");
      expect(nonProgressLines[1]).toBe("WARN: Deprecated API");
    });
  });

  describe("Buffer Handling", () => {
    it("should handle incomplete lines in buffer", () => {
      const receivedEvents: ProgressEvent[] = [];
      const parser = new ProgressParser((event) => {
        receivedEvents.push(event);
      });

      const progressEvent = {
        timestamp: "2024-01-01T00:00:00Z",
        stage: "init",
      };

      const fullLine = JSON.stringify(progressEvent) + "\n";
      const part1 = fullLine.slice(0, 20);
      const part2 = fullLine.slice(20);

      // Feed first part (incomplete)
      parser.feed(part1);
      expect(receivedEvents.length).toBe(0);

      // Feed second part (completes the line)
      parser.feed(part2);
      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].stage).toBe("init");
    });

    it("should handle multiple incomplete lines", () => {
      const receivedEvents: ProgressEvent[] = [];
      const parser = new ProgressParser((event) => {
        receivedEvents.push(event);
      });

      const event1 = { timestamp: "2024-01-01T00:00:00Z", stage: "init" };
      const event2 = { timestamp: "2024-01-01T00:00:01Z", stage: "complete" };

      const line1 = JSON.stringify(event1) + "\n";
      const line2 = JSON.stringify(event2) + "\n";

      // Split across boundaries
      const chunk1 = line1.slice(0, 15);
      const chunk2 = line1.slice(15) + line2.slice(0, 20);
      const chunk3 = line2.slice(20);

      parser.feed(chunk1);
      expect(receivedEvents.length).toBe(0);

      parser.feed(chunk2);
      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].stage).toBe("init");

      parser.feed(chunk3);
      expect(receivedEvents.length).toBe(2);
      expect(receivedEvents[1].stage).toBe("complete");
    });

    it("should handle Buffer input", () => {
      const receivedEvents: ProgressEvent[] = [];
      const parser = new ProgressParser((event) => {
        receivedEvents.push(event);
      });

      const progressEvent = {
        timestamp: "2024-01-01T00:00:00Z",
        stage: "rule_parsing",
        total: 100,
      };

      const buffer = Buffer.from(JSON.stringify(progressEvent) + "\n", "utf-8");
      parser.feed(buffer);

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].stage).toBe("rule_parsing");
      expect(receivedEvents[0].total).toBe(100);
    });

    it("should ignore empty lines", () => {
      const receivedEvents: ProgressEvent[] = [];
      const nonProgressLines: string[] = [];

      const parser = new ProgressParser(
        (event) => {
          receivedEvents.push(event);
        },
        (line) => {
          nonProgressLines.push(line);
        },
      );

      parser.feed("\n\n\n");

      expect(receivedEvents.length).toBe(0);
      expect(nonProgressLines.length).toBe(0);
    });

    it("should handle lines with only whitespace", () => {
      const receivedEvents: ProgressEvent[] = [];
      const nonProgressLines: string[] = [];

      const parser = new ProgressParser(
        (event) => {
          receivedEvents.push(event);
        },
        (line) => {
          nonProgressLines.push(line);
        },
      );

      parser.feed("   \n\t\n  \t  \n");

      expect(receivedEvents.length).toBe(0);
      expect(nonProgressLines.length).toBe(0);
    });
  });

  describe("Edge Cases", () => {
    it("should reject progress events with invalid stage", () => {
      const receivedEvents: ProgressEvent[] = [];
      const nonProgressLines: string[] = [];

      const parser = new ProgressParser(
        (event) => {
          receivedEvents.push(event);
        },
        (line) => {
          nonProgressLines.push(line);
        },
      );

      const invalidEvent = {
        timestamp: "2024-01-01T00:00:00Z",
        stage: "invalid_stage",
      };

      parser.feed(JSON.stringify(invalidEvent) + "\n");

      // Invalid stage means it's not a valid progress event
      // Should be filtered out as non-progress JSON
      expect(receivedEvents.length).toBe(0);
      expect(nonProgressLines.length).toBe(0);
    });

    it("should reject events missing required timestamp field", () => {
      const receivedEvents: ProgressEvent[] = [];
      const parser = new ProgressParser((event) => {
        receivedEvents.push(event);
      });

      const invalidEvent = {
        stage: "init",
        // missing timestamp
      };

      parser.feed(JSON.stringify(invalidEvent) + "\n");

      expect(receivedEvents.length).toBe(0);
    });

    it("should work without non-progress callback", () => {
      const receivedEvents: ProgressEvent[] = [];
      const parser = new ProgressParser((event) => {
        receivedEvents.push(event);
      });

      const progressEvent = {
        timestamp: "2024-01-01T00:00:00Z",
        stage: "init",
      };

      // Should not throw when non-progress callback is not provided
      parser.feed(JSON.stringify(progressEvent) + "\n");
      parser.feed("Some error message\n");
      parser.feed(JSON.stringify({ type: 1, data: "test" }) + "\n");

      expect(receivedEvents.length).toBe(1);
    });
  });
});
