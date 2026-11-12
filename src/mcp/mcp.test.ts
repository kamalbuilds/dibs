import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DibsApiError, DibsClient, parseSaleRef, type PublicSale, type SellerSale } from "./client.js";
import { claim, invoiceStatus, listSale, SessionMemory } from "./tools.js";
import { createDibsHttpApp, createDibsMcpServer } from "./server.js";

const BASE = "https://dibs.test";
const SALE_ID = "sale-1";
const KEY = "seller-key-123";
const CLOSES = Date.UTC(2026, 11, 21, 12);

function makeSale(): PublicSale {
  return { id: SALE_ID, slug: "kJ4emW4", title: "Conan Doyle Characters", status: "OPEN", closesAtMs: CLOSES, depositPercent: 20, items: [
    { id: "i1", number: 1, title: "Sherlock Holmes", priceCents: 4800, status: "OPEN", photoUrl: "/api/items/i1/photo?v=1", backupCount: 0 },
    { id: "i2", number: 2, title: "Dr. Watson", priceCents: 2800, status: "CLAIMED", photoUrl: null, backupCount: 1 },
    { id: "i3", number: 3, title: "Moriarty", priceCents: 3600, status: "PAID", photoUrl: null, backupCount: 0 },
  ] };
}

const seller: SellerSale = {
  sale: { id: SALE_ID, slug: "kJ4emW4", title: "Conan Doyle Characters", status: "OPEN", closes_at_ms: CLOSES, fee_policy: "split", invoice_mode: "sale_close" },
  items: [
    { id: "i1", number: 1, title: "Sherlock Holmes", price_cents: 4800, status: "OPEN" },
    { id: "i2", number: 2, title: "Dr. Watson", price_cents: 2800, status: "CLAIMED" },
    { id: "i3", number: 3, title: "Moriarty", price_cents: 3600, status: "INVOICED" },
  ],
  claims: [
    { item_id: "i2", handle: "watsonfan", at_ms: 100, sequence: 1, kind: "claim" },
    { item_id: "i2", handle: "bev", at_ms: 200, sequence: 2, kind: "backup" },
    { item_id: "i3", handle: "jules", at_ms: 50, sequence: 3, kind: "claim" },
    { item_id: "i3", handle: "tomas", at_ms: 60, sequence: 4, kind: "backup" },
  ],
  invoices: [
    { id: "inv-old", buyer_handle: "jules", buyer_email: "j@example.com", payer_url: null, status: "CANCELLED", subtotal_cents: 3600, shipping_cents: 100, fee_cents: 50, total_cents: 3750, due_at_ms: 1000, items: [{ id: "i3", number: 3, title: "Moriarty" }] },
    { id: "inv-new", buyer_handle: "tomas", buyer_email: "t@example.com", payer_url: "https://paypal.test/inv", status: "SENT", subtotal_cents: 3600, shipping_cents: 100, fee_cents: 50, total_cents: 3750, due_at_ms: CLOSES + 86_400_000, items: [{ id: "i3", number: 3, title: "Moriarty" }] },
  ],
  events: [],
};

type Call = { method: string; url: string; body?: unknown; key: string | null };

function mockApi(options: { claimResponse?: unknown; claimStatus?: number; afterClaim?: Partial<PublicSale> } = {}) {
  const calls: Call[] = [];
  let claimed = false;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const call: Call = { method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined, key: headers.get("x-seller-key") };
    calls.push(call);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const path = url.slice(BASE.length);
    if (path === "/api/public/sales/kJ4emW4") return json(200, claimed && options.afterClaim ? { ...makeSale(), ...options.afterClaim } : makeSale());
    if (path.startsWith("/api/public/sales/")) return json(404, { error: "Sale not found" });
    if (path === `/api/sales/${SALE_ID}/claims` && call.method === "POST") { claimed = true; return json(options.claimStatus ?? 201, options.claimResponse ?? { claims: [], invoices: [] }); }
    if (path === `/api/sales/${SALE_ID}`) return call.key === KEY ? json(200, seller) : json(401, { error: "Seller key required" });
    if (path === "/api/receipts/inv-new") return json(200, { invoice: { id: "inv-new", buyerHandle: "tomas", status: "SENT", subtotalCents: 3600, shippingCents: 100, feeCents: 50, totalCents: 3750, payerUrl: "https://paypal.test/inv" }, items: [{ number: 3, title: "Moriarty", price_cents: 3600 }], shipment: null });
    if (path.startsWith("/api/receipts/")) return json(404, { error: "Receipt not found" });
    return json(500, { error: `unmocked ${path}` });
  }) as typeof fetch;
  return { calls, fetchImpl, client: new DibsClient(BASE, fetchImpl, undefined) };
}

describe("parseSaleRef", () => {
  it("accepts slugs and links", () => {
    expect(parseSaleRef("kJ4emW4")).toBe("kJ4emW4");
    expect(parseSaleRef("https://dibs-claims.fly.dev/s/kJ4emW4?x=1")).toBe("kJ4emW4");
    expect(parseSaleRef(" /s/abc_9 ")).toBe("abc_9");
    expect(() => parseSaleRef("not a sale!")).toThrow(DibsApiError);
  });
});

describe("list_sale", () => {
  it("returns items with absolute photos and public backup counts only", async () => {
    const { client, calls } = mockApi();
    const { data, text } = await listSale(client, { sale: "https://dibs-claims.fly.dev/s/kJ4emW4" });
    expect(calls).toHaveLength(1);
    expect(data.queueVisibility).toBe("public");
    expect(data.items[0]).toMatchObject({ number: 1, title: "Sherlock Holmes", priceCents: 4800, status: "OPEN", claimable: true, photoUrl: `${BASE}/api/items/i1/photo?v=1` });
    expect(data.items[1]).toMatchObject({ number: 2, claimable: true, backupCount: 1 });
    expect(data.items[2]).toMatchObject({ number: 3, claimable: false });
    expect(text).toContain("#01 Sherlock Holmes · $48.00 · OPEN");
  });

  it("adds claimers and backup queues with a seller key", async () => {
    const { client, calls } = mockApi();
    const { data, text } = await listSale(client, { sale: "kJ4emW4", sellerKey: KEY });
    expect(calls[1].key).toBe(KEY);
    expect(data.queueVisibility).toBe("seller");
    expect(data.items[1]).toMatchObject({ claimedBy: "@watsonfan" });
    expect(JSON.stringify(data.items[1])).toContain("@bev");
    expect(text).toContain("@watsonfan");
  });

  it("surfaces server errors", async () => {
    const { client } = mockApi();
    await expect(listSale(client, { sale: "missing" })).rejects.toMatchObject({ status: 404, message: "Sale not found" });
  });
});

describe("claim", () => {
  it("maps pocket numbers to item ids and reports First / Backup N with server time", async () => {
    const { client, calls } = mockApi({
      claimResponse: { claims: [{ itemId: "i1", handle: "kamal", atMs: 1_000, sequence: 9, kind: "claim" }, { itemId: "i2", handle: "kamal", atMs: 1_001, sequence: 10, kind: "backup" }], invoices: [] },
      afterClaim: { items: makeSale().items.map((item) => item.id === "i2" ? { ...item, backupCount: 2 } : item) },
    });
    const memory = new SessionMemory();
    const { data, text } = await claim(client, memory, { sale: "kJ4emW4", itemNumbers: [1, 2], handle: "@kamal", email: "k@example.com", deposit: true });
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.url).toBe(`${BASE}/api/sales/${SALE_ID}/claims`);
    expect(post.body).toEqual({ handle: "kamal", email: "k@example.com", itemIds: ["i1", "i2"], hold: true });
    expect(data.results.map((row) => row.label)).toEqual(["First", "Backup 2"]);
    expect(data.results[0].serverTimestamp).toBe(new Date(1_000).toISOString());
    expect(data.nextSteps.join(" ")).toMatch(/when the seller closes the sale/);
    expect(data.nextSteps.join(" ")).toMatch(/backup line/);
    expect(data.nextSteps.join(" ")).toMatch(/20% deposit/);
    expect(text).toContain("#02 Dr. Watson ($28.00): Backup 2");
  });

  it("passes a claim comment through for the server to parse", async () => {
    const { client, calls } = mockApi({ claimResponse: { claims: [{ itemId: "i1", handle: "kamal", atMs: 5, sequence: 1, kind: "claim" }], invoices: [] } });
    await claim(client, new SessionMemory(), { sale: "kJ4emW4", commentText: "mine 1", handle: "kamal", email: "k@example.com" });
    expect(calls.find((call) => call.method === "POST")!.body).toEqual({ handle: "kamal", email: "k@example.com", text: "mine 1" });
  });

  it("reports an invoice issued on claim and remembers it for invoice_status", async () => {
    const invoice = { ...seller.invoices[1], buyer_handle: "kamal" };
    const { client, calls } = mockApi({ claimResponse: { claims: [{ itemId: "i1", handle: "kamal", atMs: 5, sequence: 1, kind: "claim" }], invoices: [invoice] } });
    const memory = new SessionMemory();
    const { data } = await claim(client, memory, { sale: "kJ4emW4", itemNumbers: [1], handle: "kamal", email: "k@example.com" });
    expect(data.invoices[0]).toMatchObject({ invoiceId: "inv-new", status: "SENT", total: "$37.50", payUrl: "https://paypal.test/inv", receiptUrl: `${BASE}/receipt/inv-new` });
    expect(data.nextSteps[0]).toMatch(/PayPal has emailed/);
    const status = await invoiceStatus(client, memory, { sale: "kJ4emW4", handle: "@kamal" });
    expect(calls.at(-1)!.url).toBe(`${BASE}/api/receipts/inv-new`);
    expect(status.data.invoices[0]).toMatchObject({ invoiceId: "inv-new", status: "SENT", totalCents: 3750 });
  });

  it("rejects unknown pockets before calling the server and surfaces server rejections", async () => {
    const { client, calls } = mockApi({ claimStatus: 409, claimResponse: { error: "This sale is closed" } });
    await expect(claim(client, new SessionMemory(), { sale: "kJ4emW4", itemNumbers: [9], handle: "k", email: "k@example.com" })).rejects.toThrow(/Pocket #09 is not in/);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    await expect(claim(client, new SessionMemory(), { sale: "kJ4emW4", itemNumbers: [1], handle: "k", email: "k@example.com" })).rejects.toMatchObject({ status: 409, message: "This sale is closed" });
    await expect(claim(client, new SessionMemory(), { sale: "kJ4emW4", handle: "k", email: "k@example.com" })).rejects.toThrow(/itemNumbers/);
  });
});

describe("invoice_status", () => {
  it("reads a receipt by invoice id", async () => {
    const { client } = mockApi();
    const { data, text } = await invoiceStatus(client, new SessionMemory(), { invoiceId: "inv-new" });
    expect(data.invoices[0]).toMatchObject({ buyer: "@tomas", status: "SENT", subtotalCents: 3600, shippingCents: 100, feeCents: 50 });
    expect(text).toContain("awaiting payment");
  });

  it("uses the seller view for state, fee split, due time and rollover", async () => {
    const { client } = mockApi();
    const tomas = await invoiceStatus(client, new SessionMemory(), { sale: "kJ4emW4", handle: "tomas", sellerKey: KEY });
    expect(tomas.data.invoices[0]).toMatchObject({ invoiceId: "inv-new", status: "SENT", dueAt: new Date(CLOSES + 86_400_000).toISOString() });
    expect(tomas.data.invoices[0].feePolicy).toMatch(/split/);
    const jules = await invoiceStatus(client, new SessionMemory(), { sale: "kJ4emW4", handle: "@jules", sellerKey: KEY });
    expect(jules.data.invoices).toHaveLength(0);
    expect(jules.text).toMatch(/rolled to backup @tomas/);
    const bev = await invoiceStatus(client, new SessionMemory(), { sale: "kJ4emW4", handle: "bev", sellerKey: KEY });
    expect(bev.text).toMatch(/Backup 1/);
  });

  it("explains when nothing is known yet", async () => {
    const { client } = mockApi();
    const { data, text } = await invoiceStatus(client, new SessionMemory(), { sale: "kJ4emW4", handle: "nobody" });
    expect(data.invoices).toEqual([]);
    expect(text).toMatch(/DIBS_SELLER_KEY/);
    await expect(invoiceStatus(client, new SessionMemory(), {})).rejects.toBeInstanceOf(DibsApiError);
  });
});

describe("MCP server", () => {
  async function connect() {
    const { client: dibs, calls } = mockApi({ claimResponse: { claims: [{ itemId: "i1", handle: "kamal", atMs: 5, sequence: 1, kind: "claim" }], invoices: [] } });
    const server = createDibsMcpServer(dibs);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { client, calls };
  }

  it("lists the three tools with schemas and annotations", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["claim", "invoice_status", "list_sale"]);
    const claimTool = tools.find((tool) => tool.name === "claim")!;
    expect(claimTool.inputSchema.required).toEqual(expect.arrayContaining(["sale", "handle", "email"]));
    expect(tools.find((tool) => tool.name === "list_sale")!.annotations?.readOnlyHint).toBe(true);
    expect(claimTool.annotations?.readOnlyHint).toBe(false);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toContain("claim_from_post");
  });

  it("returns text plus structured content, and isError for API failures", async () => {
    const { client } = await connect();
    const listed = await client.callTool({ name: "list_sale", arguments: { sale: "kJ4emW4" } });
    expect(listed.isError).toBeFalsy();
    expect((listed.structuredContent as { items: unknown[] }).items).toHaveLength(3);
    const claimed = await client.callTool({ name: "claim", arguments: { sale: "kJ4emW4", itemNumbers: [1], handle: "kamal", email: "k@example.com" } });
    expect((claimed.content as Array<{ text: string }>)[0].text).toContain("First");
    const missing = await client.callTool({ name: "list_sale", arguments: { sale: "nope" } });
    expect(missing.isError).toBe(true);
    expect((missing.content as Array<{ text: string }>)[0].text).toMatch(/Sale not found \(HTTP 404\)/);
  });

  it("validates inputs with zod before reaching Dibs", async () => {
    const { client, calls } = await connect();
    const bad = await client.callTool({ name: "claim", arguments: { sale: "kJ4emW4", itemNumbers: [1], handle: "kamal", email: "not-an-email" } });
    expect(bad.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("serves the sale resource and the claim prompt", async () => {
    const { client } = await connect();
    const resource = await client.readResource({ uri: "dibs://sale/kJ4emW4" });
    expect(JSON.parse((resource.contents[0] as { text: string }).text).sale.slug).toBe("kJ4emW4");
    const prompt = await client.getPrompt({ name: "claim_from_post", arguments: { post: "Claim sale tonight https://dibs-claims.fly.dev/s/kJ4emW4", want: "Sherlock", handle: "kamal", email: "k@example.com" } });
    expect((prompt.messages[0].content as { text: string }).text).toMatch(/list_sale/);
  });
});

describe("Streamable HTTP mode", () => {
  const rpc = (app: ReturnType<typeof createDibsHttpApp>, host: string, id: number, name: string, args: unknown) => app.request("http://" + host + "/mcp", {
    method: "POST", headers: { host, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
  });

  it("never uses DIBS_SELLER_KEY, rejects foreign Host headers, and keeps no memory between callers", async () => {
    process.env.DIBS_SELLER_KEY = KEY;
    try {
      const { calls, fetchImpl } = mockApi({ claimResponse: { claims: [{ itemId: "i1", handle: "tomas", atMs: 5, sequence: 1, kind: "claim" }], invoices: [{ ...seller.invoices[1], items: [] }] } });
      const app = createDibsHttpApp({ baseUrl: BASE, fetchImpl, port: 8790 });
      const listed = await rpc(app, "127.0.0.1:8790", 1, "list_sale", { sale: "kJ4emW4" });
      expect(listed.status).toBe(200);
      expect((await listed.json()).result.structuredContent.queueVisibility).toBe("public");
      expect(calls.map((call) => call.key)).not.toContain(KEY);

      expect((await rpc(app, "attacker.example:8790", 2, "list_sale", { sale: "kJ4emW4" })).status).toBe(403);

      expect((await rpc(app, "localhost:8790", 3, "claim", { sale: "kJ4emW4", itemNumbers: [1], handle: "tomas", email: "t@example.com" })).status).toBe(200);
      const status = await (await rpc(app, "localhost:8790", 4, "invoice_status", { sale: "kJ4emW4", handle: "tomas" })).json();
      expect(status.result.structuredContent.invoices).toEqual([]);
    } finally { delete process.env.DIBS_SELLER_KEY; }
  });
});
