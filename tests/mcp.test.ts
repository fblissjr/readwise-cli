import { expect, test, describe, mock, spyOn, beforeEach, afterEach } from "bun:test";

// Mock the Client class from MCP SDK
const mockConnect = mock(async () => {});
const mockClose = mock(async () => {});
const mockListTools = mock(async () => ({ tools: [{ name: "mocked_tool", inputSchema: { type: "object" } }] }));
const mockCallTool = mock(async () => ({ content: [{ type: "text", text: "success" }] }));

mock.module("@modelcontextprotocol/sdk/client/index.js", () => {
  return {
    Client: class MockClient {
      name: string;
      version: string;
      constructor(opts: { name: string; version: string }) {
        this.name = opts.name;
        this.version = opts.version;
      }
      connect = mockConnect;
      close = mockClose;
      listTools = mockListTools;
      callTool = mockCallTool;
    }
  };
});

let lastTransportInit: any = null;

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => {
  return {
    StreamableHTTPClientTransport: class MockTransport {
      constructor(url: URL, init: any) {
        lastTransportInit = init;
      }
    }
  };
});

import { getSharedClient, closeSharedClient, getTools, callTool, generateToolsHash } from "../src/mcp.ts";
import * as configModule from "../src/config.ts";

describe("MCP", () => {
  beforeEach(() => {
    mockConnect.mockClear();
    mockClose.mockClear();
    mockListTools.mockClear();
    mockCallTool.mockClear();
    lastTransportInit = null;
    // Restore default behaviors
    mockConnect.mockImplementation(async () => {});
    mockListTools.mockImplementation(async () => ({ tools: [{ name: "mocked_tool", inputSchema: { type: "object" } }] }));
  });

  afterEach(async () => {
    await closeSharedClient();
  });

  test("getSharedClient should instantiate, connect, and cache the client", async () => {
    const client1 = await getSharedClient("mytoken", "token");
    expect(client1).toBeDefined();
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // Re-getting should return same instance without re-connecting
    const client2 = await getSharedClient("mytoken", "token");
    expect(client2).toBe(client1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  test("closeSharedClient should close and clean up client", async () => {
    await getSharedClient("mytoken", "token");
    await closeSharedClient();
    expect(mockClose).toHaveBeenCalledTimes(1);

    // Re-getting should connect a new one
    await getSharedClient("mytoken", "token");
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  test("getTools should fetch and cache tools", async () => {
    // Force refresh config mocks
    spyOn(configModule, "loadConfig").mockImplementation(async () => ({}));
    const saveSpy = spyOn(configModule, "saveConfig").mockImplementation(async () => {});

    // Ensure we list tools
    const tools = await getTools("mytoken", "token", true);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("mocked_tool");
    expect(mockListTools).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledTimes(1);

    saveSpy.mockRestore();
    mock.restore();
  });

  test("callTool should delegate calling to client", async () => {
    const result = await callTool("mytoken", "token", "mocked_tool", { param: "val" });
    expect(result.content[0]?.text).toBe("success");
    expect(mockCallTool).toHaveBeenCalledTimes(1);
  });

  test("generateToolsHash should produce deterministic hashes regardless of tool order", () => {
    const tools1 = [
      { name: "tool_a", inputSchema: { type: "object" } },
      { name: "tool_b", inputSchema: { type: "object" } }
    ];
    const tools2 = [
      { name: "tool_b", inputSchema: { type: "object" } },
      { name: "tool_a", inputSchema: { type: "object" } }
    ];

    const hash1 = generateToolsHash(tools1);
    const hash2 = generateToolsHash(tools2);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex length
  });

  test("getTools should handle HTTP 304 Not Modified network status and refresh cache TTL", async () => {
    const mockTools = [{ name: "mocked_tool", inputSchema: { type: "object" } }];
    const cachedConfig = {
      tools_cache: {
        tools: mockTools,
        fetched_at: Date.now() - 1000,
        etag: "mock-hash-12345",
        version: 2
      }
    };
    spyOn(configModule, "loadConfig").mockImplementation(async () => cachedConfig);
    const saveSpy = spyOn(configModule, "saveConfig").mockImplementation(async () => {});

    mockConnect.mockImplementation(async () => {
      throw new Error("HTTP error: 304 Not Modified");
    });

    const isCacheValidSpy = spyOn(configModule, "isCacheValid").mockReturnValue(false);

    const tools = await getTools("mytoken", "token", false);
    expect(tools).toEqual(mockTools);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(lastTransportInit?.requestInit?.headers["If-None-Match"]).toBe("mock-hash-12345");

    isCacheValidSpy.mockRestore();
    saveSpy.mockRestore();
    mock.restore();
  });

  test("getTools should handle client-side Checksum Layer cache hit when server returns identical tools", async () => {
    const mockTools = [{ name: "mocked_tool", inputSchema: { type: "object" } }];
    const expectedHash = generateToolsHash(mockTools);

    const cachedConfig = {
      tools_cache: {
        tools: mockTools,
        fetched_at: Date.now() - 1000,
        etag: expectedHash,
        version: 2
      }
    };
    spyOn(configModule, "loadConfig").mockImplementation(async () => cachedConfig);
    const saveSpy = spyOn(configModule, "saveConfig").mockImplementation(async () => {});

    mockConnect.mockImplementation(async () => {});
    mockListTools.mockImplementation(async () => ({ tools: mockTools }));

    const isCacheValidSpy = spyOn(configModule, "isCacheValid").mockReturnValue(false);

    const tools = await getTools("mytoken", "token", false);
    expect(tools).toEqual(mockTools);
    expect(saveSpy).toHaveBeenCalledTimes(1);

    isCacheValidSpy.mockRestore();
    saveSpy.mockRestore();
    mock.restore();
  });
});
