/**
 * importproof MCP server, built on the SDK's
 * low-level Server type.
 *
 * The high-level registration helper would rebuild
 * each input schema from a zod shape and add keys the
 * capture does not carry, so it is deliberately not
 * used here. Instead, tools/list is served straight
 * from the captured literals held in forward.ts, and
 * tools/call requests are validated for shape and
 * then relayed upstream by the forwarding client.
 *
 * Results come back exactly as the client returns
 * them, upstream isError state included. An unknown
 * tool name fails with MethodNotFound and arguments
 * that are not a JSON object fail with InvalidParams;
 * both checks happen before any network traffic.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createClient,
  isKnownTool,
  TOOL_DEFS,
  VERSION,
  type ImportproofClient,
} from "./forward.js";
import type { ForwardDeps, ToolResult } from "./types.js";

export async function handleCallTool(
  client: ImportproofClient,
  name: string,
  args: unknown,
): Promise<ToolResult> {
  if (!isKnownTool(name)) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
  if (
    args !== undefined &&
    (typeof args !== "object" || args === null || Array.isArray(args))
  ) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Arguments for tool ${name} must be a JSON object`,
    );
  }
  return client.callTool(name, (args ?? {}) as Record<string, unknown>);
}

export function createServer(deps: ForwardDeps = {}): Server {
  const client = createClient(deps);
  const server = new Server(
    { name: "importproof", version: VERSION },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS,
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await handleCallTool(client, name, args);
    return result as never;
  });
  return server;
}

export async function startMcpServer(deps: ForwardDeps = {}): Promise<void> {
  await createServer(deps).connect(new StdioServerTransport());
}
