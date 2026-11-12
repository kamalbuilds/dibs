import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { z } from "zod";
import { DibsApiError, DibsClient } from "./client.js";
import { awaitPayment, claim, invoiceStatus, listSale, SessionMemory, type ToolResult } from "./tools.js";

const saleArg = z.string().min(1).describe("The sale: its slug (kJ4emW4) or link (https://dibs-claims.fly.dev/s/kJ4emW4).");
const sellerKeyArg = z.string().min(8).optional().describe("Optional seller access key for this sale. Unlocks buyer handles in queues and the seller's invoice view. Defaults to DIBS_SELLER_KEY if set. Never needed to claim.");

async function run<T>(fn: () => Promise<ToolResult<T>>) {
  try {
    const result = await fn();
    return { content: [{ type: "text" as const, text: result.text }], structuredContent: result.data as unknown as Record<string, unknown> };
  } catch (error) {
    const message = error instanceof DibsApiError ? `Dibs said: ${error.message}${error.status ? ` (HTTP ${error.status})` : ""}` : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}

export function createDibsMcpServer(client = new DibsClient(), memory = new SessionMemory(), options: { sleep?: (ms: number) => Promise<void> } = {}): McpServer {
  const server = new McpServer({ name: "dibs", version: "1.0.0" }, {
    instructions: "Dibs runs collectible claim sales: buyers claim numbered pockets, the server timestamp decides who is first, later claimers join a backup line, and each winner gets one PayPal Goods & Services invoice. Unpaid invoices are cancelled and the item rolls to the next backup. Always list_sale before claiming, confirm pocket numbers, handle and email with the user, then claim. A claim result carries a 402-style payment block (amount, PayPal invoice, pay URL, expiry); after the buyer opens the pay link, call await_payment to wait for PAID.",
  });

  server.registerTool("list_sale", {
    title: "List a Dibs claim sale",
    description: "Read a Dibs claim sale: title, deadline, and every numbered pocket with title, price, status (OPEN, CLAIMED, INVOICED, PAID, SHIPPED), whether it can still be claimed (CLAIMED items accept backups), backup count, photo URL. Read-only. Use before claim to map what the user wants to pocket numbers.",
    inputSchema: { sale: saleArg, sellerKey: sellerKeyArg },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args) => run(() => listSale(client, args)));

  server.registerTool("claim", {
    title: "Claim pockets in a Dibs sale",
    description: "Call dibs on one or more pockets for a buyer. The Dibs server timestamps the claim and decides the outcome: First (you won it) or Backup N (you are Nth in line and get invoiced automatically if those ahead pass). Winners get one PayPal Goods & Services invoice by email (sent now or when the seller closes the sale, depending on the sale). This places a real claim under the given handle: confirm pocket numbers, handle and email with the user first. Safe to retry: repeating the same claim (same handle, email and pockets) returns the original result and invoice, marked retried, instead of claiming twice. The server rate-limits claims per connection and per handle (HTTP 429 with a retry time).",
    inputSchema: {
      sale: saleArg,
      itemNumbers: z.array(z.number().int().positive()).min(1).max(50).optional().describe("Pocket numbers to claim, e.g. [3, 7]. Use list_sale to find them."),
      commentText: z.string().min(1).max(200).optional().describe("Alternative to itemNumbers: a claim comment exactly as a buyer would post it, e.g. \"mine 3 and 7\". The server parses it."),
      handle: z.string().min(1).max(80).describe("Buyer's social handle (with or without @). It is shown on the sale as the claimer."),
      email: z.email().describe("Email PayPal sends the Goods & Services invoice to."),
      deposit: z.boolean().optional().describe("Hold the pockets with the sale's deposit percentage (partial PayPal payment) instead of paying in full."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (args) => run(() => claim(client, memory, args)));

  server.registerTool("invoice_status", {
    title: "PayPal invoice status for a Dibs buyer",
    description: "Check a buyer's PayPal Goods & Services invoice on Dibs: state (drafting, sent/awaiting payment, deposit held, paid, cancelled), amount with items, shipping and fee line, due time, pay link, tracking, and whether an unpaid item rolled to a backup. Reads Dibs' copy of the PayPal invoice, which Dibs syncs from PayPal every 15 seconds (so PAID can take a few seconds to appear). Pass invoiceId (from claim or the receipt link), or sale + handle/email (works for invoices this session created, or for everything with a seller key). Read-only.",
    inputSchema: {
      invoiceId: z.string().min(1).optional().describe("Dibs invoice id (the id in /receipt/<id>)."),
      sale: saleArg.optional(),
      handle: z.string().min(1).max(80).optional().describe("Buyer handle to look up."),
      email: z.email().optional().describe("Buyer email to look up."),
      sellerKey: sellerKeyArg,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args) => run(() => invoiceStatus(client, memory, args)));

  server.registerTool("await_payment", {
    title: "Wait for a PayPal invoice to be paid",
    description: "After a claim returns a 402-style payment requirement, wait until the buyer pays. Polls Dibs, which reads the invoice from PayPal Invoicing v2 on demand (at most once every 3 seconds per invoice), until it is PAID or CANCELLED or the timeout passes, then returns the final state. Read-only: it never pays or changes anything. Pass the invoiceId from the claim's payment block (or the sale and handle claimed in this session). If it times out, call it again.",
    inputSchema: {
      invoiceId: z.string().min(1).optional().describe("Dibs invoice id (payment.invoiceId in the claim result, or the id in /receipt/<id>)."),
      sale: saleArg.optional(),
      handle: z.string().min(1).max(80).optional().describe("Buyer handle used in this session's claim, when no invoiceId is given."),
      timeoutSeconds: z.number().min(5).max(600).optional().describe("How long to wait. Default 120."),
      intervalSeconds: z.number().min(2).max(30).optional().describe("Seconds between checks. Default 4."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  }, async (args, extra) => run(() => awaitPayment(client, memory, args, {
    sleep: options.sleep,
    onPoll: async (poll, status, elapsedMs, timeoutMs) => {
      const progressToken = extra._meta?.progressToken;
      if (progressToken === undefined) return;
      await extra.sendNotification({ method: "notifications/progress", params: { progressToken, progress: Math.min(elapsedMs, timeoutMs), total: timeoutMs, message: `Check ${poll}: ${status}` } }).catch(() => undefined);
    },
  })));

  server.registerResource("sale", new ResourceTemplate("dibs://sale/{slug}", { list: undefined }), {
    title: "Dibs sale", description: "A Dibs claim sale as JSON (same data as list_sale).", mimeType: "application/json",
  }, async (uri, { slug }) => {
    const result = await listSale(client, { sale: String(slug) });
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(result.data, null, 2) }] };
  });

  server.registerPrompt("claim_from_post", {
    title: "Claim from a seller's post",
    description: "Paste a seller's X / Instagram / Discord claim-sale post (or a Dibs link) and what you want; the assistant finds the pockets and claims them for you.",
    argsSchema: { post: z.string().describe("The seller's post or thread text, including the Dibs sale link."), want: z.string().describe("What you want, in your words, e.g. 'Sherlock Holmes and anything under $15'."), handle: z.string().describe("Your social handle."), email: z.string().describe("Email for the PayPal invoice.") },
  }, ({ post, want, handle, email }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Here is a claim-sale post:\n\n${post}\n\nI want: ${want}\nMy handle: ${handle}\nInvoice email: ${email}\n\n1. Find the Dibs sale link or slug in the post and call list_sale.\n2. Match what I want to pocket numbers; skip anything already PAID or SHIPPED; tell me which are open and which would make me a backup.\n3. Show me the pockets, prices and total and ask me to confirm.\n4. After I confirm, call claim once with those itemNumbers.\n5. Report First / Backup N with the server timestamp and the 402-style payment block (amount, pay link, expiry). If payment is required, give me the pay link and call await_payment until it reports PAID; if the invoice is pending, tell me when it will be sent.` } }],
  }));

  return server;
}

// Streamable HTTP is reachable by anyone who can reach the port, so it runs as a buyer: DIBS_SELLER_KEY is never
// loaded (a caller may still pass its own sellerKey), each request gets fresh claim memory, and the Host header must
// be one this server answers on (DNS rebinding protection). Add public hostnames with MCP_ALLOWED_HOSTS=host:port,...
export function createDibsHttpApp(options: { port: number; baseUrl?: string; fetchImpl?: typeof fetch }) {
  const client = new DibsClient(options.baseUrl, options.fetchImpl, null);
  const allowedHosts = [`127.0.0.1:${options.port}`, `localhost:${options.port}`, ...(process.env.MCP_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean)];
  const app = new Hono();
  app.get("/", (c) => c.json({ name: "dibs-mcp", endpoint: "/mcp", dibs: client.baseUrl }));
  app.all("/mcp", async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, enableDnsRebindingProtection: true, allowedHosts });
    await createDibsMcpServer(client, new SessionMemory()).connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  return app;
}
