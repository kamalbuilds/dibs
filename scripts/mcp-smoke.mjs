// Spawns the Dibs MCP server on stdio and calls its tools like an assistant would.
// Usage: node scripts/mcp-smoke.mjs list_sale '{"sale":"kJ4emW4"}'   (DIBS_BASE_URL picks the API)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const calls = [];
for (let i = 2; i < process.argv.length; i += 2) calls.push([process.argv[i], JSON.parse(process.argv[i + 1] ?? "{}")]);
const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/mcp/main.ts"], env: { ...process.env }, stderr: "inherit" });
const client = new Client({ name: "dibs-smoke", version: "1.0.0" });
await client.connect(transport);
const { tools } = await client.listTools();
console.log("tools:", tools.map((tool) => tool.name).join(", "));
for (const [name, args] of calls) {
  const result = await client.callTool({ name, arguments: args });
  console.log(`\n=== ${name} ${JSON.stringify(args)}${result.isError ? " (error)" : ""}\n${result.content.map((part) => part.text).join("\n")}`);
  if (process.env.SMOKE_JSON) console.log(JSON.stringify(result.structuredContent, null, 2));
}
await client.close();
