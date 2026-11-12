#!/usr/bin/env node
// Dibs MCP server. stdio by default; `--http [port]` serves Streamable HTTP at /mcp (stateless).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { serve } from "@hono/node-server";
import { DibsClient } from "./client.js";
import { createDibsHttpApp, createDibsMcpServer } from "./server.js";

const args = process.argv.slice(2);
const httpIndex = args.indexOf("--http");
if (httpIndex === -1) {
  const client = new DibsClient();
  const server = createDibsMcpServer(client);
  await server.connect(new StdioServerTransport());
  console.error(`dibs-mcp on stdio → ${client.baseUrl}`);
} else {
  const port = Number(args[httpIndex + 1] || process.env.MCP_PORT || 8790);
  const app = createDibsHttpApp({ port });
  serve({ fetch: app.fetch, port, hostname: process.env.MCP_HOST || "127.0.0.1" }, (info) => console.error(`dibs-mcp Streamable HTTP on http://127.0.0.1:${info.port}/mcp → ${new DibsClient().baseUrl}`));
}
