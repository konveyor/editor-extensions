import { ExtensionState } from "../../../extensionState";
import { ModifiedFileState } from "@editor-extensions/shared";
import { KaiWorkflowMessage, KaiWorkflowMessageType } from "@editor-extensions/agentic";

// Mock the cleanupOnError function to test it
jest.mock("../handleModifiedFile", () => {
  const originalModule = jest.requireActual("../handleModifiedFile");
  return {
    ...originalModule,
    cleanupOnError: jest.fn(),
  };
});

describe("handleModifiedFileMessage error handling", () => {
  let mockState: Partial<ExtensionState>;
  let mockModifiedFiles: Map<string, ModifiedFileState>;
  let mockModifiedFilesPromises: Array<Promise<void>>;
  let mockProcessedTokens: Set<string>;
  let mockPendingInteractions: Map<string, (response: any) => void>;
  let mockMessageQueue: KaiWorkflowMessage[];
  let mockEventEmitter: { emit: jest.Mock };

  beforeEach(() => {
    mockState = {
      isWaitingForUserInteraction: true,
      mutateData: jest.fn(),
      data: {
        chatMessages: [],
      } as any,
    };

    mockModifiedFiles = new Map();
    mockModifiedFilesPromises = [];
    mockProcessedTokens = new Set();
    mockPendingInteractions = new Map();
    mockMessageQueue = [];
    mockEventEmitter = { emit: jest.fn() };
  });

  it("should call cleanupOnError when an error occurs during file processing", async () => {
    const { handleModifiedFileMessage } = require("../handleModifiedFile");
    const { cleanupOnError } = require("../handleModifiedFile");

    const mockMessage: KaiWorkflowMessage = {
      id: "test-message-id",
      type: KaiWorkflowMessageType.ModifiedFile,
      data: {
        path: "/test/file.java",
        content: "test content",
      },
    };

    // Mock processModifiedFile to throw an error
    jest.doMock("../processModifiedFile", () => ({
      processModifiedFile: jest.fn().mockRejectedValue(new Error("Processing failed")),
    }));

    try {
      await handleModifiedFileMessage(
        mockMessage,
        mockModifiedFiles,
        mockModifiedFilesPromises,
        mockProcessedTokens,
        mockPendingInteractions,
        mockMessageQueue,
        mockState as ExtensionState,
        undefined,
        mockEventEmitter,
      );
    } catch (error) {
      // Expected to throw due to mocked error
    }

    // Verify cleanupOnError was called with correct parameters
    expect(cleanupOnError).toHaveBeenCalledWith(
      "/test/file.java",
      "test-message-id",
      mockState,
      mockModifiedFiles,
      mockPendingInteractions,
      mockProcessedTokens,
      mockModifiedFilesPromises,
      mockEventEmitter,
      expect.any(Error),
    );
  });

  it("should reset isWaitingForUserInteraction even if cleanup fails", async () => {
    const { handleModifiedFileMessage } = require("../handleModifiedFile");
    const { cleanupOnError } = require("../handleModifiedFile");

    // Mock cleanupOnError to throw an error
    (cleanupOnError as jest.Mock).mockImplementation(() => {
      throw new Error("Cleanup failed");
    });

    const mockMessage: KaiWorkflowMessage = {
      id: "test-message-id",
      type: KaiWorkflowMessageType.ModifiedFile,
      data: {
        path: "/test/file.java",
        content: "test content",
      },
    };

    // Mock processModifiedFile to throw an error
    jest.doMock("../processModifiedFile", () => ({
      processModifiedFile: jest.fn().mockRejectedValue(new Error("Processing failed")),
    }));

    try {
      await handleModifiedFileMessage(
        mockMessage,
        mockModifiedFiles,
        mockModifiedFilesPromises,
        mockProcessedTokens,
        mockPendingInteractions,
        mockMessageQueue,
        mockState as ExtensionState,
        undefined,
        mockEventEmitter,
      );
    } catch (error) {
      // Expected to throw due to mocked error
    }

    // Verify isWaitingForUserInteraction is reset even if cleanup fails
    expect(mockState.isWaitingForUserInteraction).toBe(false);
  });
});
