// End to end without the network: MCP client → DibsClient → the real Hono routes → submitClaims → SQLite,
// with only PayPal's HTTP API replaced by an in-memory fake.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "dibs-mcp-e2e-"));
process.env.PAYPAL_CLIENT_ID = "test-client";
process.env.PAYPAL_CLIENT_SECRET = "test-secret";

const remote = new Map<string, string>();
let created = 0;
vi.mock("../paypal.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../paypal.js")>();
  const view = (id: string) => ({ id, status: remote.get(id)!, payerUrl: `https://www.sandbox.paypal.com/invoice/p/#${id}`, transactionIds: remote.get(id) === "PAID" ? ["TX-1"] : [] });
  return {
    ...actual,
    createInvoice: vi.fn(async () => { const id = `INV2-TEST-${++created}`; remote.set(id, "DRAFT"); return view(id); }),
    readInvoice: vi.fn(async (id: string) => view(id)),
    sendInvoice: vi.fn(async (id: string) => { remote.set(id, "SENT"); return view(id); }),
    cancelInvoice: vi.fn(async (id: string) => { remote.set(id, "CANCELLED"); return view(id); }),
  };
});

const { app } = await import("../routes.js");
const { addSaleItem, createNewSale, publish, reconcileInvoices } = await import("../service.js");
const { claimLimitPerHandle, claimLimitPerIp } = await import("../rate-limit.js");
const { DibsClient } = await import("./client.js");
const { createDibsMcpServer } = await import("./server.js");

const BASE = "http://dibs.test";
type Text = Array<{ text: string }>;

function freshSale(invoiceMode: "first_claim" | "sale_close") {
  const { sale } = createNewSale({ title: "Agent sale", deadlineMinutes: 5, invoiceMode, shipping: { tiers: [{ label: "Mailer", amountCents: 100 }] }, feePolicy: "split", feeRateBasisPoints: 349, feeFixedCents: 49, depositBasisPoints: 2000 });
  addSaleItem(sale.id, { title: "Irene Adler", priceCents: 2600 });
  addSaleItem(sale.id, { title: "Dr. Watson", priceCents: 2800 });
  publish(sale.id);
  return sale;
}

async function connect() {
  const dibs = new DibsClient(BASE, ((input: string | URL | Request, init?: RequestInit) => app.request(String(input), init)) as typeof fetch, undefined);
  const server = createDibsMcpServer(dibs);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const post = (saleId: string, body: unknown, ip = "203.0.113.7") => app.request(`/api/sales/${saleId}/claims`, { method: "POST", headers: { "content-type": "application/json", "fly-client-ip": ip }, body: JSON.stringify(body) });

beforeEach(() => {
  claimLimitPerIp.reset(); claimLimitPerHandle.reset();
  delete process.env.CLAIM_RATE_PER_IP; delete process.env.CLAIM_RATE_PER_HANDLE; delete process.env.CLAIM_RATE_WINDOW_MS;
});

describe("agent claim through the real Dibs routes", () => {
  it("claims first, gets a SENT PayPal invoice with a pay link, retries safely, and reads PAID", async () => {
    const sale = freshSale("first_claim");
    const client = await connect();

    const listed = await client.callTool({ name: "list_sale", arguments: { sale: `${BASE}/s/${sale.slug}` } });
    expect((listed.content as Text)[0].text).toContain("#01 Irene Adler · $26.00 · OPEN");

    const args = { sale: sale.slug, itemNumbers: [1], handle: "@kamal_demo", email: "buyer@example.com" };
    const claimed = await client.callTool({ name: "claim", arguments: args });
    const data = claimed.structuredContent as { results: Array<{ label: string }>; invoices: Array<{ invoiceId: string; status: string; payUrl: string }>; retried: boolean };
    expect(claimed.isError).toBeFalsy();
    expect(data.results[0].label).toBe("First");
    expect(data.invoices[0]).toMatchObject({ status: "SENT", payUrl: "https://www.sandbox.paypal.com/invoice/p/#INV2-TEST-1" });
    const text = (claimed.content as Text)[0].text;
    expect(text).toMatch(/PayPal invoice \S+: SENT, \$27\.\d\d, due .*, pay at https:\/\/www\.sandbox\.paypal\.com\/invoice\/p\/#INV2-TEST-1/);
    expect(text).toMatch(/PayPal has emailed/);

    const retried = await client.callTool({ name: "claim", arguments: args });
    const again = retried.structuredContent as typeof data;
    expect(retried.isError).toBeFalsy();
    expect(again.retried).toBe(true);
    expect(again.results[0].label).toBe("First");
    expect(again.invoices[0].invoiceId).toBe(data.invoices[0].invoiceId);
    expect(created).toBe(1);

    const backup = await client.callTool({ name: "claim", arguments: { ...args, handle: "second", email: "second@example.com" } });
    expect((backup.structuredContent as typeof data).results[0].label).toBe("Backup 1");

    remote.set("INV2-TEST-1", "PAID");
    await reconcileInvoices();
    const status = await client.callTool({ name: "invoice_status", arguments: { sale: sale.slug, handle: "kamal_demo" } });
    expect((status.content as Text)[0].text).toMatch(/: PAID, \$27\.\d\d .*Paid on PayPal/);
  });

  it("keeps rejecting a genuinely conflicting repeat (same handle, different email)", async () => {
    const sale = freshSale("sale_close");
    const item = (await (await app.request(`/api/public/sales/${sale.slug}`)).json()).items[0].id;
    expect((await post(sale.id, { handle: "dup", email: "a@example.com", itemIds: [item] })).status).toBe(201);
    const replay = await post(sale.id, { handle: "@dup".slice(1), email: "A@example.com", itemIds: [item] });
    expect(replay.status).toBe(200);
    expect((await replay.json()).replayed).toBe(true);
    const conflict = await post(sale.id, { handle: "dup", email: "someone-else@example.com", itemIds: [item] });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error).toBe("This handle already claimed the selected item");
  });
});

describe("claim rate limits", () => {
  it("limits one handle per sale and answers 429 with Retry-After", async () => {
    process.env.CLAIM_RATE_PER_HANDLE = "2";
    const sale = freshSale("sale_close");
    const items = (await (await app.request(`/api/public/sales/${sale.slug}`)).json()).items.map((row: { id: string }) => row.id);
    expect((await post(sale.id, { handle: "fast", email: "f@example.com", itemIds: [items[0]] }, "198.51.100.1")).status).toBe(201);
    expect((await post(sale.id, { handle: "@FAST", email: "f@example.com", itemIds: [items[1]] }, "198.51.100.2")).status).toBe(201);
    const limited = await post(sale.id, { handle: "fast", email: "f@example.com", itemIds: [items[0]] }, "198.51.100.3");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await limited.json()).error).toMatch(/Too many claim attempts for fast/);
    expect((await post(sale.id, { handle: "other", email: "o@example.com", itemIds: [items[0]] }, "198.51.100.3")).status).toBe(201);
  });

  it("limits one client IP across handles, and the MCP tool reports it clearly", async () => {
    process.env.CLAIM_RATE_PER_IP = "3";
    const sale = freshSale("sale_close");
    const items = (await (await app.request(`/api/public/sales/${sale.slug}`)).json()).items.map((row: { id: string }) => row.id);
    for (const handle of ["a", "b", "c"]) expect((await post(sale.id, { handle, email: `${handle}@example.com`, itemIds: [items[0]] }, "192.0.2.9")).status).toBe(201);
    const limited = await post(sale.id, { handle: "d", email: "d@example.com", itemIds: [items[0]] }, "192.0.2.9");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await post(sale.id, { handle: "d", email: "d@example.com", itemIds: [items[0]] }, "192.0.2.10")).status).toBe(201);
  });

  it("frees the window after it passes, and 0 turns a limit off", async () => {
    const { SlidingWindowLimiter } = await import("../rate-limit.js");
    let limit = 1;
    const limiter = new SlidingWindowLimiter(() => limit, () => 1000);
    expect(limiter.check("k", 0).ok).toBe(true);
    expect(limiter.check("k", 500)).toEqual({ ok: false, retryAfterSeconds: 1 });
    expect(limiter.check("k", 1001).ok).toBe(true);
    limit = 0;
    for (let i = 0; i < 50; i++) expect(limiter.check("k", 1002).ok).toBe(true);
  });
});

describe("claim responses", () => {
  it("only return invoices for the claimer's own handle and email", async () => {
    const sale = freshSale("first_claim");
    const [first, second] = (await (await app.request(`/api/public/sales/${sale.slug}`)).json()).items.map((item: { id: string }) => item.id);
    const a = await (await post(sale.id, { handle: "shared", email: "a@example.com", itemIds: [first] })).json();
    expect(a.invoices.map((invoice: { buyer_email: string }) => invoice.buyer_email)).toEqual(["a@example.com"]);
    const b = await post(sale.id, { handle: "@shared".slice(1), email: "b@example.com", itemIds: [second] });
    expect(b.status).toBe(201);
    const emails = (await b.json()).invoices.map((invoice: { buyer_email: string }) => invoice.buyer_email);
    expect(emails).toEqual(["b@example.com"]);
    const replay = await (await post(sale.id, { handle: "SHARED", email: "A@example.com", itemIds: [first] })).json();
    expect(replay.replayed).toBe(true);
    expect(replay.invoices.map((invoice: { buyer_email: string }) => invoice.buyer_email)).toEqual(["a@example.com"]);
  });
});
