#!/usr/bin/env node
// Dibs MCP server. stdio by default; `--http [port]` serves Streamable HTTP at /mcp (stateless).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { DibsClient } from "./client.js";
import { createDibsMcpServer } from "./server.js";
import { SessionMemory } from "./tools.js";

const args = process.argv.slice(2);
const httpIndex = args.indexOf("--http");
const client = new DibsClient();

if (httpIndex === -1) {
  const server = createDibsMcpServer(client);
  await server.connect(new StdioServerTransport());
  console.error(`dibs-mcp on stdio → ${client.baseUrl}`);
} else {
  const port = Number(args[httpIndex + 1] || process.env.MCP_PORT || 8790);
  const memory = new SessionMemory();
  const app = new Hono();
  app.get("/", (c) => c.json({ name: "dibs-mcp", endpoint: "/mcp", dibs: client.baseUrl }));
  app.all("/mcp", async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createDibsMcpServer(client, memory);
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  serve({ fetch: app.fetch, port, hostname: process.env.MCP_HOST || "127.0.0.1" }, (info) => console.error(`dibs-mcp Streamable HTTP on http://127.0.0.1:${info.port}/mcp → ${client.baseUrl}`));
}
