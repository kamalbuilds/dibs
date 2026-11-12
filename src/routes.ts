import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { ClaimInputSchema, ItemInputSchema, SaleInputSchema, ThreadSchema } from "./ai-schemas.js";
import { aiModel, identifyItems, parseThread } from "./ai.js";
import { parseClaimCommand } from "./domain.js";
import { db, getInvoice, getItem, getSaleById, listItems, listInvoices } from "./store.js";
import { addSaleItem, cancelAndPass, closeAndInvoice, confirmImportedClaims, createNewSale, editSaleItem, handleInvoiceWebhook, ownerAuthorized, publish, recordShipment, reconcileInvoices, remind, removeSaleItem, resolveImportPreview, salePublicBySlug, saleSellerById, submitClaims, subscribe, retryInvoice } from "./service.js";
import { verifyWebhook } from "./paypal.js";

export const app = new Hono();
const missingSetup = () => ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "OPENROUTER_API_KEY"].filter((key) => !process.env[key]);
const keyFor = (context: Context) => context.req.header("x-seller-key");
const validationError = (error: unknown) => error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") : error instanceof Error ? error.message : "Request failed";

function requireOwner(context: Context, saleId: string) {
  const sale = getSaleById(saleId);
  if (!ownerAuthorized(sale, keyFor(context))) throw new Error("Seller access key required");
  return sale;
}

app.get("/api/health", (c) => c.json({ ok: true, missing: missingSetup() }));
app.get("/api/config", (c) => c.json({ missing: missingSetup(), demoBuyerEmail: process.env.DEMO_BUYER_EMAIL || null, aiModel: aiModel(), paypalEnvironment: process.env.PAYPAL_ENV === "live" ? "live" : "sandbox" }));

app.post("/api/sales", async (c) => {
  try {
    const input = SaleInputSchema.parse(await c.req.json());
    const result = createNewSale({
      title: input.title, deadlineMinutes: input.deadlineMinutes, invoiceMode: input.invoiceMode,
      shipping: { tiers: input.shippingTiers, freeOverCents: input.freeOverCents }, feePolicy: input.feePolicy,
      feeRateBasisPoints: input.feeRateBasisPoints, feeFixedCents: input.feeFixedCents,
    });
    return c.json({ sale: result.sale, ownerKey: result.ownerKey }, 201);
  } catch (error) { return c.json({ error: validationError(error) }, 400); }
});

app.get("/api/sales/:id", (c) => {
  try {
    const sale = requireOwner(c, c.req.param("id"));
    const result = saleSellerById(sale.id);
    if (!result) return c.json({ error: "Sale not found" }, 404);
    const { owner_key_hash: _privateHash, ...safeSale } = result.sale;
    return c.json({ ...result, sale: safeSale });
  } catch (error) { return c.json({ error: validationError(error) }, 401); }
});

app.get("/api/public/sales/:slug", (c) => {
  const sale = salePublicBySlug(c.req.param("slug"));
  return sale ? c.json(sale) : c.json({ error: "Sale not found" }, 404);
});

app.post("/api/sales/:id/items", async (c) => {
  try {
    const sale = requireOwner(c, c.req.param("id"));
    const input = ItemInputSchema.parse(await c.req.json());
    const item = addSaleItem(sale.id, input);
    return c.json({ item }, 201);
  } catch (error) { return c.json({ error: validationError(error) }, error instanceof z.ZodError ? 400 : 401); }
});

app.patch("/api/items/:id", async (c) => {
  try {
    const item = getItem(c.req.param("id"));
    if (!item) return c.json({ error: "Item not found" }, 404);
    requireOwner(c, item.sale_id);
    const input = ItemInputSchema.parse(await c.req.json());
    return c.json({ item: editSaleItem(item.id, input) });
  } catch (error) { return c.json({ error: validationError(error) }, error instanceof z.ZodError ? 400 : 401); }
});

app.delete("/api/items/:id", (c) => {
  try {
    const item = getItem(c.req.param("id"));
    if (!item) return c.json({ error: "Item not found" }, 404);
    requireOwner(c, item.sale_id);
    removeSaleItem(item.id);
    return c.json({ ok: true });
  } catch (error) { return c.json({ error: validationError(error) }, 400); }
});

app.post("/api/sales/:id/vision", async (c) => {
  try {
    const sale = requireOwner(c, c.req.param("id"));
    const form = await c.req.formData();
    const files = form.getAll("photos").filter((value): value is File => value instanceof File);
    if (!files.length || files.length > 4) return c.json({ error: "Add between one and four sale photos" }, 400);
    const items = [];
    for (const file of files) {
      const identified = await identifyItems(Buffer.from(await file.arrayBuffer()), file.type);
      items.push(...identified.items);
    }
    // ponytail: read_text is returned for the review screen only, not stored; persist it if sellers need it after reload.
    const added = items.map((item) => ({ ...addSaleItem(sale.id, { title: item.title, setOrPlatform: item.set_or_platform, conditionNotes: item.condition_notes, confidence: item.confidence }), read_text: item.read_text }));
    return c.json({ items: added }, 201);
  } catch (error) { return c.json({ error: validationError(error) }, 400); }
});

app.post("/api/sales/:id/publish", (c) => {
  try {
    const sale = requireOwner(c, c.req.param("id"));
    const published = publish(sale.id);
    return c.json({ sale: published, url: `/s/${published.slug}` });
  } catch (error) { return c.json({ error: validationError(error) }, 400); }
});

app.post("/api/sales/:id/close", async (c) => {
  try {
    const sale = requireOwner(c, c.req.param("id"));
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) return c.json({ error: "PayPal setup requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET" }, 503);
    return c.json({ invoices: await closeAndInvoice(sale.id) });
  } catch (error) { return c.json({ error: validationError(error) }, 400); }
});

app.post("/api/sales/:id/claims", async (c) => {
  try {
    const sale = getSaleById(c.req.param("id"));
    if (!sale?.published_at_ms) return c.json({ error: "Sale not found" }, 404);
    const input = ClaimInputSchema.parse(await c.req.json());
    const parsed = input.text ? parseClaimCommand(input.text, listItems(sale.id)) : { itemIds: input.itemIds ?? [], unresolved: [] };
    if (!parsed.itemIds.length || parsed.unresolved.length) return c.json({ error: parsed.unresolved.length ? `Review item references: ${parsed.unresolved.join(", ")}` : "Enter item numbers to claim" }, 400);
    const claims = await submitClaims(sale.id, { ...input, itemIds: parsed.itemIds });
    return c.json({ claims: claims.map((claim) => ({ itemId: claim.item_id, handle: claim.handle, atMs: claim.at_ms, sequence: claim.sequence, kind: claim.kind })), invoices: listInvoices(sale.id).filter((invoice) => invoice.buyer_handle.toLowerCase() === input.handle.toLowerCase()) }, 201);
  } catch (error) { return c.json({ error: validationError(error) }, error instanceof z.ZodError ? 400 : 409); }
});

app.post("/api/sales/:id/import/preview", async (c) => {
  try {
    const sale = requireOwner(c, c.req.param("id"));
    const body = z.object({ text: z.string().trim().min(1).max(150_000) }).parse(await c.req.json());
    const events = await parseThread(body.text);
    return c.json({ events: resolveImportPreview(sale.id, events) });
  } catch (error) { return c.json({ error: validationError(error) }, error instanceof z.ZodError ? 400 : 401); }
});

const importedRows = z.object({ events: z.array(z.object({
  handle: z.string().trim().min(1), email: z.union([z.email(), z.literal("")]), raw: z.string().min(1), kind: z.enum(["claim", "backup", "question", "other"]),
  itemIds: z.array(z.string().min(1)), atMs: z.number().int().nonnegative(),
})).min(1) }).strict();

app.post("/api/sales/:id/import/confirm", async (c) => {
  try {
    const sale = requireOwner(c, c.req.param("id"));
    const body = importedRows.parse(await c.req.json());
    const claims = await confirmImportedClaims(sale.id, body.events);
    return c.json({ claims: claims.map((claim) => ({ handle: claim.handle, itemId: claim.item_id, atMs: claim.at_ms, kind: claim.kind })) });
  } catch (error) { return c.json({ error: validationError(error) }, error instanceof z.ZodError ? 400 : 401); }
});

app.post("/api/invoices/:id/retry", async (c) => {
  try {
    const invoice = getInvoice(c.req.param("id"));
    if (!invoice) return c.json({ error: "Invoice not found" }, 404);
    requireOwner(c, invoice.sale_id);
    return c.json({ invoice: await retryInvoice(invoice.id) });
  } catch (error) { return c.json({ error: validationError(error) }, 400); }
});

app.post("/api/invoices/:id/remind", async (c) => {
  try {
    const invoice = getInvoice(c.req.param("id"));
    if (!invoice) return c.json({ error: "Invoice not found" }, 404);
    requireOwner(c, invoice.sale_id);
    await remind(invoice.id);
    return c.json({ ok: true });
  } catch (error) { return c.json({ error: validationError(error) }, 400); }
});

app.post("/api/invoices/:id/cancel", async (c) => {
  try {
    const invoice = getInvoice(c.req.param("id"));
    if (!invoice) return c.json({ error: "Invoice not found" }, 404);
    requireOwner(c, invoice.sale_id);
    await cancelAndPass(invoice.id);
    return c.json({ ok: true });
  } catch (error) { return c.json({ error: validationError(error) }, 400); }
});

app.post("/api/invoices/:id/ship", async (c) => {
  try {
    const invoice = getInvoice(c.req.param("id"));
    if (!invoice) return c.json({ error: "Invoice not found" }, 404);
    requireOwner(c, invoice.sale_id);
    const body = z.object({ carrier: z.string().trim().min(1).max(60), tracking: z.string().trim().min(1).max(120) }).strict().parse(await c.req.json());
    recordShipment(invoice.id, body.carrier, body.tracking);
    return c.json({ ok: true });
  } catch (error) { return c.json({ error: validationError(error) }, error instanceof z.ZodError ? 400 : 401); }
});

app.get("/api/receipts/:id", (c) => {
  const invoice = getInvoice(c.req.param("id"));
  if (!invoice) return c.json({ error: "Receipt not found" }, 404);
  const items = db.prepare("SELECT items.number,items.title,items.price_cents FROM items JOIN invoice_items ON invoice_items.item_id=items.id WHERE invoice_items.invoice_id=? ORDER BY items.number").all(invoice.id);
  const shipment = db.prepare("SELECT carrier,tracking FROM shipments WHERE invoice_id=?").get(invoice.id);
  return c.json({ invoice: { id: invoice.id, buyerHandle: invoice.buyer_handle, status: invoice.status, subtotalCents: invoice.subtotal_cents, shippingCents: invoice.shipping_cents, feeCents: invoice.fee_cents, totalCents: invoice.total_cents, payerUrl: invoice.payer_url }, items, shipment });
});

app.get("/api/events", (c) => {
  const saleId = c.req.query("saleId");
  if (!saleId || !getSaleById(saleId)?.published_at_ms) return c.json({ error: "Live sale not found" }, 404);
  return streamSSE(c, async (stream) => {
    let queue: Array<{ id: string; type: string; payload: string; at_ms: number; sale_id: string; item_id: string | null }> = [];
    let wake: (() => void) | undefined;
    const unsubscribe = subscribe(saleId, (entry) => { queue.push(entry); wake?.(); });
    stream.onAbort(unsubscribe);
    try {
      while (!stream.closed) {
        if (queue.length) {
          const entry = queue.shift()!;
          await stream.writeSSE({ id: entry.id, event: entry.type, data: JSON.stringify({ ...entry, payload: JSON.parse(entry.payload) }) });
          continue;
        }
        await Promise.race([new Promise<void>((resolve) => { wake = resolve; }), stream.sleep(15_000)]);
        wake = undefined;
        if (!queue.length) await stream.writeSSE({ event: "ping", data: "" });
      }
    } finally { unsubscribe(); }
  });
});

app.post("/api/paypal/webhook", async (c) => {
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid webhook JSON" }, 400); }
  try {
    if (!await verifyWebhook(body, c.req.raw.headers)) return c.json({ error: "PayPal webhook signature is invalid" }, 401);
    const eventType = String(body.event_type ?? "");
    const resource = body.resource as { id?: unknown } | undefined;
    if (typeof resource?.id === "string" && ["INVOICING.INVOICE.PAID", "INVOICING.INVOICE.CANCELLED"].includes(eventType)) await handleInvoiceWebhook(resource.id, eventType);
    return c.json({ received: true });
  } catch (error) { return c.json({ error: validationError(error) }, 500); }
});

app.onError((error, c) => {
  console.error("Request failed", { method: c.req.method, path: c.req.path, message: error.message });
  return c.json({ error: "Request failed" }, 500);
});

export async function runReconciler(): Promise<void> {
  await reconcileInvoices();
}
