import { expect, test, describe, mock, spyOn, beforeEach, afterEach } from "bun:test";
import {
  getConfigPath,
  loadConfig,
  saveConfig,
  isCacheValid,
  getConfigValue,
  getConfigDefault,
  getAllConfigEntries,
  setConfigValue,
  filterReadOnlyTools,
  TOOLS_CACHE_VERSION,
  type Config,
  type ToolDef
} from "../src/config.ts";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";

describe("Config", () => {
  const mockHome = "/mock/home";

  beforeEach(() => {
    mock.module("node:os", () => ({
      homedir: () => mockHome,
    }));
  });

  afterEach(() => {
    mock.restore();
  });

  test("getConfigPath should return correct path inside homedir", () => {
    const path = getConfigPath();
    expect(path).toBe(join(mockHome, ".readwise-cli.json"));
  });

  test("isCacheValid should validate the cache correct timeframe and version", () => {
    const validConfig: Config = {
      tools_cache: {
        tools: [],
        fetched_at: Date.now() - 60 * 1000, // 1 minute ago
        version: TOOLS_CACHE_VERSION
      }
    };
    expect(isCacheValid(validConfig)).toBe(true);

    const expiredConfig: Config = {
      tools_cache: {
        tools: [],
        fetched_at: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        version: TOOLS_CACHE_VERSION
      }
    };
    expect(isCacheValid(expiredConfig)).toBe(false);

    const wrongVersionConfig: Config = {
      tools_cache: {
        tools: [],
        fetched_at: Date.now() - 60 * 1000,
        version: TOOLS_CACHE_VERSION - 1
      }
    };
    expect(isCacheValid(wrongVersionConfig)).toBe(false);

    const noCacheConfig: Config = {};
    expect(isCacheValid(noCacheConfig)).toBe(false);
  });

  test("getConfigDefault should return expected default values", () => {
    expect(getConfigDefault("readonly")).toBe(false);
    expect(getConfigDefault("nonexistent")).toBeUndefined();
  });

  test("getConfigValue should return config value or default", () => {
    const config: Config = {
      config: {
        readonly: true
      }
    };
    expect(getConfigValue(config, "readonly")).toBe(true);

    const emptyConfig: Config = {};
    expect(getConfigValue(emptyConfig, "readonly")).toBe(false);
  });

  test("getAllConfigEntries should retrieve all keys", () => {
    const config: Config = {
      config: {
        readonly: true
      }
    };
    const entries = getAllConfigEntries(config);
    expect(entries).toEqual({
      readonly: true
    });
  });

  test("setConfigValue should correctly parse and set keys", () => {
    const config: Config = {};
    setConfigValue(config, "readonly", "true");
    expect(config.config?.readonly).toBe(true);

    setConfigValue(config, "readonly", "false");
    expect(config.config?.readonly).toBe(false);

    expect(() => setConfigValue(config, "readonly", "invalid")).toThrow();
    expect(() => setConfigValue(config, "nonexistent", "true")).toThrow();
  });

  test("filterReadOnlyTools should only return tools with readOnlyHint", () => {
    const tools: ToolDef[] = [
      {
        name: "tool_1",
        annotations: { readOnlyHint: true },
        inputSchema: { type: "object" }
      },
      {
        name: "tool_2",
        annotations: { readOnlyHint: false },
        inputSchema: { type: "object" }
      },
      {
        name: "tool_3",
        inputSchema: { type: "object" }
      }
    ];

    const filtered = filterReadOnlyTools(tools);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.name).toBe("tool_1");
  });

  test("loadConfig / saveConfig should read and write to path correctly", async () => {
    // Red step: let's verify loadConfig/saveConfig works with mocked filesystems or spyOn.
    const expectedPath = getConfigPath();
    const mockConfig: Config = { config: { readonly: true } };

    const writeSpy = spyOn(fsPromises, "writeFile").mockImplementation(async () => {});
    const statSpy = spyOn(fsPromises, "stat").mockImplementation(async () => {
      return { mode: 0o600 } as any;
    });
    const chmodSpy = spyOn(fsPromises, "chmod").mockImplementation(async () => {});
    const readSpy = spyOn(fsPromises, "readFile").mockImplementation(async () => {
      return JSON.stringify(mockConfig);
    });

    await saveConfig(mockConfig);
    expect(writeSpy).toHaveBeenCalledWith(expectedPath, JSON.stringify(mockConfig, null, 2) + "\n", {
      encoding: "utf-8",
      mode: 0o600
    });

    const loaded = await loadConfig();
    expect(readSpy).toHaveBeenCalledWith(expectedPath, "utf-8");
    expect(loaded).toEqual(mockConfig);

    writeSpy.mockRestore();
    statSpy.mockRestore();
    chmodSpy.mockRestore();
    readSpy.mockRestore();
  });
});
