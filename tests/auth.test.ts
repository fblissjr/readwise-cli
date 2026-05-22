import { expect, test, describe, spyOn, afterEach } from "bun:test";
import * as http from "node:http";
import { waitForCallback } from "../src/auth.ts";

describe("Auth Callback Server", () => {
  let requestHandler: any;
  let serverEvents: Record<string, Function> = {};

  const mockServer = {
    listen: (port: number, cb: () => void) => {
      // Simulate successful listen
      setTimeout(cb, 0);
      return mockServer;
    },
    on: (event: string, cb: Function) => {
      serverEvents[event] = cb;
      return mockServer;
    },
    close: (cb?: () => void) => {
      if (cb) cb();
      return mockServer;
    }
  };

  const createServerSpy = spyOn(http, "createServer").mockImplementation((handler: any) => {
    requestHandler = handler;
    return mockServer as any;
  });

  afterEach(() => {
    requestHandler = undefined;
    serverEvents = {};
  });

  test("should handle local loopback request and resolve code", async () => {
    const state = "test-state-123";
    const promise = waitForCallback(state);

    // Wait for server to set up handler
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requestHandler).toBeDefined();

    // Mock request and response
    const mockReq = {
      socket: { remoteAddress: "127.0.0.1" },
      url: `/callback?code=valid-code-456&state=${state}`
    };

    let responseStatus = 0;
    let responseHeaders = {};
    let responseBody = "";

    const mockRes = {
      writeHead: (status: number, headers: any) => {
        responseStatus = status;
        responseHeaders = headers;
        return mockRes;
      },
      end: (body: string) => {
        responseBody = body;
        return mockRes;
      }
    };

    // Invoke request handler
    requestHandler(mockReq, mockRes);

    const code = await promise;
    expect(code).toBe("valid-code-456");
    expect(responseStatus).toBe(200);
    expect(responseBody).toContain("Login successful!");
  });

  test("should reject request from non-loopback remote address", async () => {
    const state = "test-state-456";
    const promise = waitForCallback(state);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requestHandler).toBeDefined();

    const mockReq = {
      socket: { remoteAddress: "192.168.1.50" },
      url: `/callback?code=valid-code-456&state=${state}`
    };

    let responseStatus = 0;
    let responseBody = "";

    const mockRes = {
      writeHead: (status: number, headers: any) => {
        responseStatus = status;
        return mockRes;
      },
      end: (body: string) => {
        responseBody = body;
        return mockRes;
      }
    };

    // Invoke request handler with non-local IP
    requestHandler(mockReq, mockRes);

    expect(responseStatus).toBe(403);
    expect(responseBody).toContain("Forbidden");

    // The promise should still be pending or fail later. We clean it up manually by forcing a rejection/timeout.
    // Let's invoke with valid details to resolve it so we don't leak timeouts.
    const validReq = {
      socket: { remoteAddress: "::1" },
      url: `/callback?code=valid-code-456&state=${state}`
    };
    requestHandler(validReq, mockRes);
    await promise;
  });

  test("should return 404 for non-callback path", async () => {
    const state = "test-state-789";
    const promise = waitForCallback(state);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const mockReq = {
      socket: { remoteAddress: "127.0.0.1" },
      url: "/invalid-path"
    };

    let responseStatus = 0;

    const mockRes = {
      writeHead: (status: number) => {
        responseStatus = status;
        return mockRes;
      },
      end: () => {
        return mockRes;
      }
    };

    requestHandler(mockReq, mockRes);

    expect(responseStatus).toBe(404);

    // Resolve promise to clean up
    const validReq = {
      socket: { remoteAddress: "127.0.0.1" },
      url: `/callback?code=valid-code-456&state=${state}`
    };
    requestHandler(validReq, mockRes);
    await promise;
  });

  test("should reject promise on OAuth error", async () => {
    const state = "test-state-abc";
    const promise = waitForCallback(state);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const mockReq = {
      socket: { remoteAddress: "::ffff:127.0.0.1" },
      url: `/callback?error=access_denied&state=${state}`
    };

    let responseStatus = 0;
    let responseBody = "";

    const mockRes = {
      writeHead: (status: number, headers: any) => {
        responseStatus = status;
        return mockRes;
      },
      end: (body: string) => {
        responseBody = body;
        return mockRes;
      }
    };

    requestHandler(mockReq, mockRes);

    try {
      await promise;
      throw new Error("Expected promise to reject");
    } catch (err: any) {
      expect(err.message).toContain("OAuth error: access_denied");
      expect(responseStatus).toBe(200);
      expect(responseBody).toContain("Login failed");
    }
  });

  test("should reject promise on missing code or state mismatch", async () => {
    const state = "test-state-def";
    const promise = waitForCallback(state);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const mockReq = {
      socket: { remoteAddress: "127.0.0.1" },
      url: `/callback?code=valid-code&state=wrong-state`
    };

    let responseStatus = 0;
    let responseBody = "";

    const mockRes = {
      writeHead: (status: number, headers: any) => {
        responseStatus = status;
        return mockRes;
      },
      end: (body: string) => {
        responseBody = body;
        return mockRes;
      }
    };

    requestHandler(mockReq, mockRes);

    try {
      await promise;
      throw new Error("Expected promise to reject");
    } catch (err: any) {
      expect(err.message).toContain("Invalid callback: missing code or state mismatch");
      expect(responseStatus).toBe(400);
      expect(responseBody).toContain("Invalid callback");
    }
  });

  test("should reject promise if server emits error", async () => {
    const state = "test-state-err";
    const promise = waitForCallback(state);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(serverEvents["error"]).toBeDefined();

    // Trigger EADDRINUSE error
    const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    serverEvents["error"]({ code: "EADDRINUSE" });

    try {
      await promise;
      throw new Error("Expected promise to reject");
    } catch (err: any) {
      expect(err.message).toContain("Port 6274 is already in use");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
