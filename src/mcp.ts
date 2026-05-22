import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig, saveConfig, isCacheValid, TOOLS_CACHE_VERSION, type ToolDef } from "./config.js";
import { VERSION } from "./version.js";

const MCP_URL = process.env.READWISE_MCP_URL || "https://mcp2.readwise.io/mcp";

export function generateToolsHash(tools: ToolDef[]): string {
  const sortedTools = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  const serialized = JSON.stringify(sortedTools);
  return createHash("sha256").update(serialized).digest("hex");
}

function createTransport(token: string, authType: "oauth" | "token", etag?: string): StreamableHTTPClientTransport {
  const authHeader = authType === "token" ? `Token ${token}` : `Bearer ${token}`;
  const headers: Record<string, string> = {
    Authorization: authHeader,
  };
  if (etag) {
    headers["If-None-Match"] = etag;
  }
  return new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: {
      headers,
    },
  });
}

let sharedClient: Client | null = null;
let sharedTransport: StreamableHTTPClientTransport | null = null;

export async function getSharedClient(token: string, authType: "oauth" | "token"): Promise<Client> {
  if (process.env.READWISE_OFFLINE === "true") {
    if (sharedClient) return sharedClient;
    sharedClient = new Client({ name: "readwise-mock", version: VERSION });
    return sharedClient;
  }
  if (sharedClient) return sharedClient;
  sharedClient = new Client({ name: "readwise", version: VERSION });
  sharedTransport = createTransport(token, authType);
  await sharedClient.connect(sharedTransport);
  return sharedClient;
}

export async function closeSharedClient(): Promise<void> {
  if (process.env.READWISE_OFFLINE === "true") {
    sharedClient = null;
    sharedTransport = null;
    return;
  }
  if (sharedClient) {
    try {
      await sharedClient.close();
    } catch {
      // Ignore cleanup errors
    }
    sharedClient = null;
    sharedTransport = null;
  }
}

export async function getTools(token: string, authType: "oauth" | "token", forceRefresh = false): Promise<ToolDef[]> {
  if (process.env.READWISE_OFFLINE === "true") {
    const config = await loadConfig();
    return config.tools_cache?.tools ?? [];
  }

  const config = await loadConfig();

  if (!forceRefresh && isCacheValid(config)) {
    return config.tools_cache!.tools;
  }

  // Use shared client if available
  if (sharedClient) {
    const result = await sharedClient.listTools();
    const tools = result.tools as ToolDef[];
    const newEtag = generateToolsHash(tools);
    const etagToSend = config.tools_cache?.etag || (config.tools_cache ? generateToolsHash(config.tools_cache.tools) : undefined);

    if (!forceRefresh && etagToSend && newEtag === etagToSend && config.tools_cache) {
      config.tools_cache.fetched_at = Date.now();
      config.tools_cache.etag = etagToSend;
      await saveConfig(config);
      return config.tools_cache.tools;
    }

    config.tools_cache = {
      tools,
      fetched_at: Date.now(),
      version: TOOLS_CACHE_VERSION,
      etag: newEtag,
    };
    await saveConfig(config);
    return tools;
  }

  let etagToSend: string | undefined = undefined;
  if (!forceRefresh && config.tools_cache) {
    etagToSend = config.tools_cache.etag || generateToolsHash(config.tools_cache.tools);
  }

  let tools: ToolDef[] | null = null;
  let newEtag: string | undefined = undefined;
  let cacheHit = false;

  try {
    const client = new Client({ name: "readwise", version: VERSION });
    const transport = createTransport(token, authType, etagToSend);
    await client.connect(transport);
    try {
      const result = await client.listTools();
      tools = result.tools as ToolDef[];
      newEtag = generateToolsHash(tools);
    } finally {
      await client.close();
    }
  } catch (err) {
    const errMsg = (err as Error).message || "";
    if (errMsg.includes("304") || errMsg.toLowerCase().includes("not modified")) {
      cacheHit = true;
    } else {
      throw err;
    }
  }

  // Checksum Layer (Layer 2)
  if (!cacheHit && tools && etagToSend && newEtag === etagToSend) {
    cacheHit = true;
  }

  if (cacheHit && config.tools_cache) {
    config.tools_cache.fetched_at = Date.now();
    config.tools_cache.etag = etagToSend || generateToolsHash(config.tools_cache.tools);
    await saveConfig(config);
    return config.tools_cache.tools;
  }

  if (tools) {
    config.tools_cache = {
      tools,
      fetched_at: Date.now(),
      version: TOOLS_CACHE_VERSION,
      etag: newEtag,
    };
    await saveConfig(config);
    return tools;
  }

  throw new Error("Failed to fetch tools schema from the server.");
}

export async function callTool(
  token: string,
  authType: "oauth" | "token",
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text?: string }>; structuredContent?: Record<string, unknown>; isError?: boolean }> {
  if (process.env.READWISE_OFFLINE === "true") {
    return {
      content: [{ type: "text", text: `Mocked success calling ${name} in offline mode` }],
    };
  }
  // If there's a pooled client, use it to avoid connection overhead
  if (sharedClient) {
    const result = await sharedClient.callTool({ name, arguments: args });
    return result as { content: Array<{ type: string; text?: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };
  }

  const client = new Client({ name: "readwise", version: VERSION });
  const transport = createTransport(token, authType);

  try {
    await client.connect(transport);
    const result = await client.callTool({ name, arguments: args });
    return result as { content: Array<{ type: string; text?: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };
  } finally {
    await client.close();
  }
}
