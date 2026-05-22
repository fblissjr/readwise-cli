import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig, saveConfig, isCacheValid, TOOLS_CACHE_VERSION, type ToolDef } from "./config.js";
import { VERSION } from "./version.js";

const MCP_URL = "https://mcp2.readwise.io/mcp";

function createTransport(token: string, authType: "oauth" | "token"): StreamableHTTPClientTransport {
  const authHeader = authType === "token" ? `Token ${token}` : `Bearer ${token}`;
  return new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: {
      headers: {
        Authorization: authHeader,
      },
    },
  });
}

let sharedClient: Client | null = null;
let sharedTransport: StreamableHTTPClientTransport | null = null;

export async function getSharedClient(token: string, authType: "oauth" | "token"): Promise<Client> {
  if (sharedClient) return sharedClient;
  sharedClient = new Client({ name: "readwise", version: VERSION });
  sharedTransport = createTransport(token, authType);
  await sharedClient.connect(sharedTransport);
  return sharedClient;
}

export async function closeSharedClient(): Promise<void> {
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
  if (!forceRefresh) {
    const config = await loadConfig();
    if (isCacheValid(config)) {
      return config.tools_cache!.tools;
    }
  }

  // Use shared client if available
  if (sharedClient) {
    const result = await sharedClient.listTools();
    const tools = result.tools as ToolDef[];

    const config = await loadConfig();
    config.tools_cache = {
      tools,
      fetched_at: Date.now(),
      version: TOOLS_CACHE_VERSION,
    };
    await saveConfig(config);
    return tools;
  }

  const client = new Client({ name: "readwise", version: VERSION });
  const transport = createTransport(token, authType);

  try {
    await client.connect(transport);
    const result = await client.listTools();

    const tools = result.tools as ToolDef[];

    // Cache
    const config = await loadConfig();
    config.tools_cache = {
      tools,
      fetched_at: Date.now(),
      version: TOOLS_CACHE_VERSION,
    };
    await saveConfig(config);

    return tools;
  } finally {
    await client.close();
  }
}

export async function callTool(
  token: string,
  authType: "oauth" | "token",
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text?: string }>; structuredContent?: Record<string, unknown>; isError?: boolean }> {
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
