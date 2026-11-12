// 402-style claim results, the on-demand PayPal refresh route and await_payment, through the real routes with PayPal faked.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "dibs-402-"));
process.env.PAYPAL_CLIENT_ID = "test-client";
process.env.PAYPAL_CLIENT_SECRET = "test-secret";

const remote = new Map<string, string>();
const reads: string[] = [];
let created = 0;
vi.mock("../paypal.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../paypal.js")>();
  const view = (id: string) => ({ id, status: remote.get(id)!, payerUrl: `https://www.sandbox.paypal.com/invoice/p/#${id}`, transactionIds: [] });
  return {
    ...actual,
    createInvoice: vi.fn(async () => { const id = `INV2-PAY-${++created}`; remote.set(id, "DRAFT"); return view(id); }),
    readInvoice: vi.fn(async (id: string) => { reads.push(id); return view(id); }),
    sendInvoice: vi.fn(async (id: string) => { remote.set(id, "SENT"); return view(id); }),
    cancelInvoice: vi.fn(async (id: string) => { remote.set(id, "CANCELLED"); return view(id); }),
  };
});

const { app } = await import("../routes.js");
const { addSaleItem, createNewSale, publish, saleSellerById } = await import("../service.js");
const { claimLimitPerHandle, claimLimitPerIp, refreshLimitPerInvoice, refreshLimitPerIp } = await import("../rate-limit.js");
const { DibsClient } = await import("./client.js");
const { createDibsMcpServer } = await import("./server.js");
const { awaitPayment, SessionMemory } = await import("./tools.js");

const BASE = "http://dibs.test";
type Text = Array<{ text: string }>;
const dibs = () => new DibsClient(BASE, ((input: string | URL | Request, init?: RequestInit) => app.request(String(input), init)) as typeof fetch, undefined);

function freshSale(invoiceMode: "first_claim" | "sale_close") {
  const { sale } = createNewSale({ title: "Pay sale", deadlineMinutes: 5, invoiceMode, shipping: { tiers: [{ label: "Mailer", amountCents: 100 }] }, feePolicy: "split", feeRateBasisPoints: 349, feeFixedCents: 49, depositBasisPoints: 2000 });
  addSaleItem(sale.id, { title: "Irene Adler", priceCents: 2600 });
  publish(sale.id);
  return sale;
}

const claimBody = (saleId: string, itemId: string, handle: string) => app.request(`/api/sales/${saleId}/claims`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle, email: `${handle}@example.com`, itemIds: [itemId] }) });
const itemOf = async (slug: string) => (await (await app.request(`/api/public/sales/${slug}`)).json()).items[0].id as string;
const refresh = (id: string, ip = "198.51.100.20") => app.request(`/api/invoices/${id}/refresh`, { method: "POST", headers: { "fly-client-ip": ip } });

beforeEach(() => {
  for (const limiter of [claimLimitPerHandle, claimLimitPerIp, refreshLimitPerInvoice, refreshLimitPerIp]) limiter.reset();
  delete process.env.INVOICE_REFRESH_MIN_INTERVAL_MS; delete process.env.INVOICE_REFRESH_PER_IP;
});

describe("402-style claim body", () => {
  it("first-claim sale: 201 with payment_required, amount, PayPal invoice, pay URL and expiry", async () => {
    const sale = freshSale("first_claim");
    const response = await claimBody(sale.id, await itemOf(sale.slug), "payer");
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.payment).toMatchObject({ status: "payment_required", httpStatusEquivalent: 402, amount: { currency: "USD" }, paypalInvoiceId: expect.stringMatching(/^INV2-PAY-/), payUrl: expect.stringContaining("sandbox.paypal.com"), invoiceId: body.invoices[0].id });
    expect(Number(body.payment.amount.value)).toBeCloseTo(body.invoices[0].total_cents / 100);
    expect(Date.parse(body.payment.expiresAt)).toBe(body.invoices[0].due_at_ms);
    expect(body.claims[0].kind).toBe("claim");
  });

  it("close-time sale: pending_invoice with when the invoice goes out, and no invoice invented", async () => {
    const sale = freshSale("sale_close");
    const body = await (await claimBody(sale.id, await itemOf(sale.slug), "waiter")).json();
    expect(body.invoices).toEqual([]);
    expect(body.payment).toMatchObject({ status: "pending_invoice", httpStatusEquivalent: 202, amount: null, invoiceId: null, payUrl: null, invoiceExpectedAt: new Date(sale.closes_at_ms).toISOString() });
  });

  it("backup claimant: nothing to pay yet", async () => {
    const sale = freshSale("first_claim");
    const item = await itemOf(sale.slug);
    await claimBody(sale.id, item, "winner");
    const body = await (await claimBody(sale.id, item, "runnerup")).json();
    expect(body.payment).toMatchObject({ status: "backup_waiting", payUrl: null, amount: null });
  });
});

describe("POST /api/invoices/:id/refresh", () => {
  it("reads PayPal on demand, flips PAID (the docket sees it), and returns only buyer-safe fields", async () => {
    const sale = freshSale("first_claim");
    const body = await (await claimBody(sale.id, await itemOf(sale.slug), "refresher")).json();
    const invoiceId = body.payment.invoiceId;
    remote.set(body.payment.paypalInvoiceId, "PAID");
    const before = reads.length;
    const response = await refresh(invoiceId);
    const view = await response.json();
    expect(reads.length).toBe(before + 1);
    expect(view.invoice.status).toBe("PAID");
    expect(view.refresh).toMatchObject({ checkedPayPal: true, remoteStatus: "PAID" });
    expect(JSON.stringify(view)).not.toMatch(/refresher@example\.com|owner|seller|buyer_email/i);
    expect(saleSellerById(sale.id)!.items[0].status).toBe("PAID");
    expect(saleSellerById(sale.id)!.events.some((event) => event.type === "invoice_paid")).toBe(true);
  });

  it("throttles PayPal reads per invoice and limits per IP with 429 + Retry-After", async () => {
    process.env.INVOICE_REFRESH_PER_IP = "3";
    const sale = freshSale("first_claim");
    const body = await (await claimBody(sale.id, await itemOf(sale.slug), "throttled")).json();
    const before = reads.length;
    expect((await (await refresh(body.payment.invoiceId, "192.0.2.50")).json()).refresh.checkedPayPal).toBe(true);
    const second = await (await refresh(body.payment.invoiceId, "192.0.2.50")).json();
    expect(second.refresh).toMatchObject({ checkedPayPal: false, reason: "throttled" });
    expect(second.invoice.status).toBe("SENT");
    expect(reads.length).toBe(before + 1);
    await refresh(body.payment.invoiceId, "192.0.2.50");
    const limited = await refresh(body.payment.invoiceId, "192.0.2.50");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await refresh("missing-invoice", "192.0.2.51")).status).toBe(404);
  });
});

describe("await_payment", () => {
  it("MCP: claim shows the 402-style line, then await_payment polls until PAID", async () => {
    process.env.INVOICE_REFRESH_MIN_INTERVAL_MS = "0";
    const sale = freshSale("first_claim");
    let sleeps = 0;
    let paypalId = "";
    const server = createDibsMcpServer(dibs(), new SessionMemory(), { sleep: async () => { sleeps += 1; if (sleeps === 2) remote.set(paypalId, "PAID"); } });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "pay", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const claimed = await client.callTool({ name: "claim", arguments: { sale: sale.slug, itemNumbers: [1], handle: "agent_buyer", email: "agent@example.com" } });
    const payment = (claimed.structuredContent as { payment: { status: string; invoiceId: string; paypalInvoiceId: string; payUrl: string } }).payment;
    paypalId = payment.paypalInvoiceId;
    expect(payment.status).toBe("payment_required");
    const text = (claimed.content as Text)[0].text;
    expect(text).toMatch(/402-style payment required: 27\.\d\d USD on PayPal invoice INV2-PAY-\d+, pay at https:\/\/www\.sandbox\.paypal\.com\S+, expires \d{4}-/);
    expect(text).not.toMatch(new RegExp(["x", "402"].join(""), "i")); // copy says 402-style only

    const progress: number[] = [];
    const waited = await client.callTool({ name: "await_payment", arguments: { invoiceId: payment.invoiceId, timeoutSeconds: 60, intervalSeconds: 2 } }, undefined, { onprogress: (p) => { progress.push(p.progress); } });
    const data = waited.structuredContent as { outcome: string; finalStatus: string; polls: number; paypalChecks: number };
    expect(data).toMatchObject({ outcome: "paid", finalStatus: "PAID", polls: 3, paypalChecks: 3 });
    expect((waited.content as Text)[0].text).toMatch(/^PAID: invoice .* 27\.\d\d USD\. Paid on PayPal/);
    expect(progress.length).toBe(3);

    const after = await client.callTool({ name: "await_payment", arguments: { sale: sale.slug, handle: "agent_buyer", timeoutSeconds: 10 } });
    expect((after.structuredContent as { outcome: string; polls: number }).polls).toBe(1);
  });

  it("times out with the current state, and stops on CANCELLED", async () => {
    process.env.INVOICE_REFRESH_MIN_INTERVAL_MS = "0";
    const sale = freshSale("first_claim");
    const body = await (await claimBody(sale.id, await itemOf(sale.slug), "slowpoke")).json();
    let clock = 0;
    const timedOut = await awaitPayment(dibs(), new SessionMemory(), { invoiceId: body.payment.invoiceId, timeoutSeconds: 12, intervalSeconds: 4 }, { now: () => clock, sleep: async (ms) => { clock += ms; } });
    expect(timedOut.data).toMatchObject({ outcome: "timeout", finalStatus: "SENT", timedOut: true, polls: 4, elapsedSeconds: 12 });
    expect(timedOut.text).toMatch(/^Still SENT after 12s/);

    remote.set(body.payment.paypalInvoiceId, "CANCELLED");
    const cancelled = await awaitPayment(dibs(), new SessionMemory(), { invoiceId: body.payment.invoiceId }, { sleep: async () => undefined });
    expect(cancelled.data.outcome).toBe("cancelled");
    await expect(awaitPayment(dibs(), new SessionMemory(), {})).rejects.toThrow(/invoiceId/);
  });

  it("falls back to the stored receipt on a Dibs server without the refresh route", async () => {
    const receipt = { invoice: { id: "inv-1", buyerHandle: "old", status: "PAID", subtotalCents: 100, shippingCents: 0, feeCents: 0, totalCents: 100, payerUrl: null }, items: [], shipment: null };
    const fetchImpl = (async (input: string | URL | Request) => String(input).endsWith("/refresh") ? new Response("404 Not Found", { status: 404 }) : new Response(JSON.stringify(receipt), { status: 200 })) as typeof fetch;
    const result = await awaitPayment(new DibsClient(BASE, fetchImpl, undefined), new SessionMemory(), { invoiceId: "inv-1" });
    expect(result.data).toMatchObject({ outcome: "paid", paypalChecks: 0 });
  });
});
