import { randomUUID } from "node:crypto";
import { calculateCart, groupByBuyer, invoiceTransition, resolveClaims, resolveItemRef, type ShippingRules } from "./domain.js";
import {
  addClaim, addEvent, addItem, addOperation, addShipment, buyerClaims, closeSale, createInvoice, createSale, deleteItem, getInvoice, getInvoiceByPayPal,
  getItem, getSaleById, getSaleBySlug, invoiceItems, listClaims, listEvents, listInvoices, listItemClaims, listItems, listOutstandingInvoices,
  listDraftInvoices, listSalesToClose, matchesOwnerKey, markInvoiceCancelled, markInvoicePaid, nextBackup, nextClaimSequence, publishSale, unbilledClaimCount, unclaimedItems, updateInvoice,
  updateItem, updateItemStatus, updateOperation, type ClaimRow, type EventRow, type InvoiceRow, type ItemRow, type SaleRow,
} from "./store.js";
import { cancelInvoice as paypalCancel, createInvoice as paypalCreate, readInvoice as paypalRead, remindInvoice as paypalRemind, sendInvoice as paypalSend, type InvoiceLine } from "./paypal.js";

type Listener = (event: EventRow) => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribe(saleId: string, listener: Listener): () => void {
  const group = listeners.get(saleId) ?? new Set<Listener>();
  group.add(listener);
  listeners.set(saleId, group);
  return () => {
    group.delete(listener);
    if (!group.size) listeners.delete(saleId);
  };
}

function event(saleId: string, type: string, payload: unknown, itemId: string | null = null): void {
  const record = addEvent(saleId, type, payload, itemId);
  for (const send of listeners.get(saleId) ?? []) send(record);
}

export function ownerAuthorized(sale: SaleRow | undefined, key: string | undefined): sale is SaleRow {
  return !!sale && matchesOwnerKey(sale, key);
}

export function sellerSale(id: string) {
  const sale = getSaleById(id);
  if (!sale) return null;
  const items = listItems(id).map((item) => ({ ...item, queue: listItemClaims(item.id).map((claim) => ({ handle: claim.handle, atMs: claim.at_ms, kind: claim.kind })) }));
  return { sale, items, claims: listClaims(id), invoices: listInvoices(id), events: listEvents(id) };
}

export function publicSale(slug: string) {
  const sale = getSaleBySlug(slug);
  if (!sale?.published_at_ms) return null;
  const items = listItems(sale.id).map((item) => ({
    id: item.id, number: item.number, title: item.title, setOrPlatform: item.set_or_platform,
    conditionNotes: item.condition_notes, priceCents: item.price_cents, status: item.status,
    backupCount: Math.max(0, unbilledClaimCount(item.id) - (item.status === "CLAIMED" ? 1 : 0)),
  }));
  return { id: sale.id, slug: sale.slug, title: sale.title, status: sale.status, closesAtMs: sale.closes_at_ms, items, updatedAtMs: Date.now() };
}

export function createNewSale(input: Parameters<typeof createSale>[0]) {
  const result = createSale(input);
  event(result.sale.id, "sale_created", { title: result.sale.title });
  return result;
}

export function addSaleItem(saleId: string, input: Parameters<typeof addItem>[1]): ItemRow {
  const sale = getSaleById(saleId);
  if (!sale || sale.status !== "OPEN" || sale.published_at_ms) throw new Error("Items can only be added before the sale is published");
  const item = addItem(saleId, input);
  event(saleId, "item_added", { number: item.number, title: item.title }, item.id);
  return item;
}

export function editSaleItem(itemId: string, input: Parameters<typeof updateItem>[1]): ItemRow {
  const item = getItem(itemId);
  const sale = item && getSaleById(item.sale_id);
  if (!item || !sale || sale.status !== "OPEN" || sale.published_at_ms) throw new Error("This sale is no longer editable");
  const updated = updateItem(itemId, input);
  event(sale.id, "item_edited", { number: item.number, title: input.title, priceCents: input.priceCents }, item.id);
  return updated;
}

export function removeSaleItem(itemId: string): void {
  const item = getItem(itemId);
  const sale = item && getSaleById(item.sale_id);
  if (!item || !sale || sale.published_at_ms || sale.status !== "OPEN") throw new Error("Only an unpublished sale item can be removed");
  deleteItem(itemId);
  event(sale.id, "item_removed", { number: item.number, title: item.title }, item.id);
}

export function publish(saleId: string): SaleRow {
  const sale = getSaleById(saleId);
  const items = listItems(saleId);
  if (!sale || sale.status !== "OPEN") throw new Error("Sale cannot be published");
  if (!items.length || items.some((item) => !item.price_cents)) throw new Error("Add at least one item and set every item price before publishing");
  publishSale(saleId);
  event(saleId, "sale_published", { itemCount: items.length, closesAtMs: sale.closes_at_ms });
  return getSaleById(saleId)!;
}

export async function submitClaims(saleId: string, input: { handle: string; email: string; itemIds: string[]; source?: "web" | "import"; raw?: string | null; atMs?: number; forcedKind?: "claim" | "backup" }): Promise<ClaimRow[]> {
  const sale = getSaleById(saleId);
  if (!sale?.published_at_ms || sale.status !== "OPEN" || sale.closes_at_ms <= Date.now()) throw new Error("This sale is closed");
  const allItems = new Map(listItems(saleId).map((item) => [item.id, item]));
  const selected = [...new Set(input.itemIds)];
  if (!selected.length || selected.some((id) => !allItems.has(id))) throw new Error("Select valid sale items");
  const added: ClaimRow[] = [];
  for (const itemId of selected) {
    const item = allItems.get(itemId)!;
    if (!item.price_cents || ["PAID", "SHIPPED"].includes(item.status)) throw new Error(`Item #${item.number} cannot be claimed`);
    if (listItemClaims(itemId).some((claim) => claim.handle.toLocaleLowerCase("en-US") === input.handle.toLocaleLowerCase("en-US"))) continue;
    const kind = input.forcedKind === "backup" ? "backup" : item.status === "OPEN" && listItemClaims(itemId).length === 0 ? "claim" : "backup";
    const sequence = nextClaimSequence(saleId);
    const atMs = input.atMs ?? Date.now();
    const claim = addClaim({ item_id: itemId, sale_id: saleId, handle: input.handle.trim(), email: input.email.trim().toLowerCase(), at_ms: atMs, sequence, kind, source: input.source ?? "web", raw: input.raw ?? null });
    if (kind === "claim") updateItemStatus(itemId, "CLAIMED");
    event(saleId, kind === "backup" ? "backup_queued" : "claim_received", { handle: claim.handle, atMs, sequence, source: claim.source }, itemId);
    added.push(claim);
  }
  if (!added.length) throw new Error("This handle already claimed the selected item");
  if (sale.invoice_mode === "first_claim") {
    const winners = added.filter((claim) => claim.kind === "claim");
    if (winners.length) await issueForClaims(sale, winners);
  }
  return added;
}

async function issueForClaims(sale: SaleRow, claims: ClaimRow[], dueIntervalMs = 24 * 60 * 60 * 1000): Promise<InvoiceRow[]> {
  return Promise.all(groupByBuyer(claims).map((group) => issueOneInvoice(sale, group, dueIntervalMs)));
}

async function issueOneInvoice(sale: SaleRow, buyer: { handle: string; email: string; claims: ClaimRow[] }, dueIntervalMs: number): Promise<InvoiceRow> {
  const itemRows = buyer.claims.map((claim) => getItem(claim.item_id)!);
  const subtotal = itemRows.reduce((sum, item) => sum + (item.price_cents ?? 0), 0);
  const totals = calculateCart(subtotal, itemRows.length, JSON.parse(sale.shipping_json) as ShippingRules, sale.fee_policy, sale.fee_rate_bp, sale.fee_fixed_cents);
  const dueAt = Date.now() + dueIntervalMs;
  const invoice = createInvoice({
    sale_id: sale.id, buyer_handle: buyer.handle, buyer_email: buyer.email, paypal_invoice_id: null, payer_url: null, status: "DRAFT",
    subtotal_cents: totals.subtotalCents, shipping_cents: totals.shippingCents, fee_cents: totals.estimatedFeeCents,
    total_cents: totals.totalCents, due_at_ms: dueAt,
  }, buyer.claims.map((claim) => ({ itemId: claim.item_id, claimId: claim.id })));
  event(sale.id, "invoice_started", { invoiceId: invoice.id, handle: buyer.handle, items: itemRows.map((item) => item.number) });
  return finishInvoice(invoice.id);
}

export async function closeAndInvoice(saleId: string, dueIntervalMs = 24 * 60 * 60 * 1000): Promise<InvoiceRow[]> {
  const sale = getSaleById(saleId);
  if (!sale || !sale.published_at_ms) throw new Error("Publish this sale before closing claims");
  if (sale.status !== "CLOSED") {
    closeSale(saleId);
    event(saleId, "sale_closed", { atMs: Date.now() });
  }
  const claimsByItem = listItems(saleId).filter((item) => item.status === "CLAIMED").map((item) => {
    const eligible = listItemClaims(item.id).map((claim) => ({ handle: claim.handle, email: claim.email, itemId: claim.item_id, atMs: claim.at_ms, sequence: claim.sequence, claim }));
    return resolveClaims(eligible)?.winner.claim;
  }).filter((claim): claim is ClaimRow => !!claim);
  return issueForClaims(sale, claimsByItem, dueIntervalMs);
}

export async function finishInvoice(invoiceId: string): Promise<InvoiceRow> {
  let invoice = getInvoice(invoiceId);
  if (!invoice) throw new Error("Invoice not found");
  if (["SENT", "UNPAID", "PAID"].includes(invoice.status)) return invoice;
  const sale = getSaleById(invoice.sale_id)!;
  const items = invoiceItems(invoice.id);
  const lines: InvoiceLine[] = items.map((item) => ({ title: `#${item.number} ${item.title}`, amountCents: item.price_cents! }));
  const buyerShare = Math.max(0, invoice.total_cents - invoice.subtotal_cents - invoice.shipping_cents);
  if (buyerShare) lines.push({ title: "Estimated PayPal fee share", amountCents: buyerShare });
  const request = { email: invoice.buyer_email, lines, shippingCents: invoice.shipping_cents, currency: "USD", note: `Claim sale: ${sale.title}`, feePolicy: sale.fee_policy };
  const createOp = addOperation("invoice_create", invoice.id, JSON.stringify(request));
  try {
    if (!invoice.paypal_invoice_id) {
      const created = await paypalCreate(request, createOp.requestId);
      invoice = { ...invoice, paypal_invoice_id: created.id };
      updateInvoice(invoice.id, { paypal_invoice_id: created.id });
    }
    const remote = await paypalRead(invoice.paypal_invoice_id!);
    updateOperation("invoice_create", invoice.id, "SUCCEEDED", remote);
    let sent = remote;
    if (remote.status === "DRAFT") {
      const sendOp = addOperation("invoice_send", invoice.id, JSON.stringify({ send_to_recipient: true, send_to_invoicer: false }));
      sent = await paypalSend(invoice.paypal_invoice_id!, sendOp.requestId);
      updateOperation("invoice_send", invoice.id, "SUCCEEDED", sent);
    } else if (!["SENT", "UNPAID", "PAID", "MARKED_AS_PAID"].includes(remote.status)) {
      throw new Error(`PayPal invoice read-back was ${remote.status}, expected DRAFT, SENT, UNPAID, or PAID`);
    }
    if (["PAID", "MARKED_AS_PAID"].includes(sent.status)) {
      await markPaid(invoice);
      updateInvoice(invoice.id, { payer_url: sent.payerUrl });
    } else updateInvoice(invoice.id, { status: sent.status, payer_url: sent.payerUrl });
    invoice = getInvoice(invoice.id)!;
    event(sale.id, "invoice_sent", { invoiceId: invoice.id, paypalInvoiceId: sent.id, status: sent.status, payerUrl: sent.payerUrl, totalCents: invoice.total_cents });
    return invoice;
  } catch (error) {
    event(invoice.sale_id, "invoice_failed", { invoiceId: invoice.id, message: error instanceof Error ? error.message : "PayPal invoice operation failed" });
    throw error;
  }
}

export async function retryInvoice(invoiceId: string): Promise<InvoiceRow> {
  return finishInvoice(invoiceId);
}

export function listSellerClaims(saleId: string) {
  return listClaims(saleId).map((claim) => ({ ...claim, item: getItem(claim.item_id) }));
}

export function resolveImportPreview(saleId: string, events: Array<{ handle: string; raw: string; kind: string; itemRefs: Array<string | number>; timestamp: string | null }>) {
  const items = listItems(saleId).map((item) => ({ id: item.id, number: item.number, title: item.title }));
  const base = Date.now();
  return events.map((entry, index) => {
    const resolutions = entry.itemRefs.map((ref) => ({ ref, ...resolveItemRef(ref, items) }));
    return {
      ...entry,
      pasteOrder: index + 1,
      resolutions,
      needsSeller: !entry.handle || entry.kind === "claim" && entry.itemRefs.length === 0 || resolutions.some((result) => result.status !== "matched"),
      atMs: parseImportedTime(entry.timestamp, base, index),
      email: "",
    };
  });
}

function parseImportedTime(value: string | null, base: number, sequence: number): number {
  if (!value) return base + sequence;
  const relative = value.trim().match(/^(\d+)\s*(s|sec|m|min|h|hr|d|day)s?$/i);
  if (relative) {
    const unit = /^(s|sec)$/i.test(relative[2]) ? 1_000 : /^(m|min)$/i.test(relative[2]) ? 60_000 : /^(h|hr)$/i.test(relative[2]) ? 3_600_000 : 86_400_000;
    return base - Number(relative[1]) * unit;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : base + sequence;
}

export async function confirmImportedClaims(saleId: string, rows: Array<{ handle: string; email: string; raw: string; kind: "claim" | "backup" | "question" | "other"; itemIds: string[]; atMs: number }>): Promise<ClaimRow[]> {
  const sale = getSaleById(saleId);
  if (!sale || sale.status !== "OPEN" || !sale.published_at_ms) throw new Error("Only a live sale can import claims");
  const imported = [...rows].sort((a, b) => a.atMs - b.atMs);
  const result: ClaimRow[] = [];
  for (const row of imported) {
    if (row.kind === "question" || row.kind === "other") {
      event(saleId, "comment_event_reviewed", { kind: row.kind, handle: row.handle, raw: row.raw, atMs: row.atMs });
      continue;
    }
    const claims = await submitClaims(saleId, { handle: row.handle, email: row.email, raw: row.raw, itemIds: row.itemIds, source: "import", atMs: row.atMs, forcedKind: row.kind });
    result.push(...claims);
  }
  return result;
}

export async function remind(invoiceId: string): Promise<void> {
  const invoice = getInvoice(invoiceId);
  if (!invoice?.paypal_invoice_id || !["SENT", "UNPAID"].includes(invoice.status)) throw new Error("Only a sent unpaid invoice can be reminded");
  const target = `${invoice.id}:remind:${randomUUID()}`;
  const op = addOperation("invoice_remind", target, JSON.stringify({ invoiceId: invoice.paypal_invoice_id }));
  await paypalRemind(invoice.paypal_invoice_id, op.requestId);
  updateOperation("invoice_remind", target, "SUCCEEDED", { sent: true });
  event(invoice.sale_id, "invoice_reminder_sent", { invoiceId: invoice.id, handle: invoice.buyer_handle });
}

export async function cancelAndPass(invoiceId: string): Promise<void> {
  const invoice = getInvoice(invoiceId);
  if (!invoice?.paypal_invoice_id || !["SENT", "UNPAID"].includes(invoice.status)) throw new Error("Only a sent unpaid invoice can be cancelled");
  const before = await paypalRead(invoice.paypal_invoice_id);
  if (before.status === "PAID" || before.status === "MARKED_AS_PAID") { await markPaid(invoice); return; }
  if (before.status === "CANCELLED") { await markCancelled(invoice); return; }
  const op = addOperation("invoice_cancel", invoice.id, JSON.stringify({ invoiceId: invoice.paypal_invoice_id }));
  const remote = await paypalCancel(invoice.paypal_invoice_id, op.requestId);
  updateOperation("invoice_cancel", invoice.id, "SUCCEEDED", remote);
  await markCancelled(invoice);
}

export function recordShipment(invoiceId: string, carrier: string, tracking: string): void {
  const invoice = getInvoice(invoiceId);
  if (!invoice || invoice.status !== "PAID") throw new Error("A buyer can be marked shipped after payment is confirmed");
  addShipment(invoiceId, carrier, tracking);
  event(invoice.sale_id, "shipment_recorded", { invoiceId, carrier, tracking, handle: invoice.buyer_handle });
}

async function releaseBackups(invoice: InvoiceRow): Promise<void> {
  const sale = getSaleById(invoice.sale_id)!;
  const promoted: ClaimRow[] = [];
  for (const item of invoiceItems(invoice.id)) {
    const backup = nextBackup(item.id);
    if (backup) {
      updateItemStatus(item.id, "CLAIMED");
      promoted.push(backup);
    } else {
      updateItemStatus(item.id, "OPEN");
      event(sale.id, "item_reopened", { itemNumber: item.number, reason: "no_backup" }, item.id);
    }
  }
  for (const claim of promoted) event(sale.id, "backup_promoted", { handle: claim.handle, atMs: claim.at_ms }, claim.item_id);
  if (promoted.length) await issueForClaims(sale, promoted);
}

async function markPaid(invoice: InvoiceRow): Promise<void> {
  if (!markInvoicePaid(invoice)) return;
  event(invoice.sale_id, "invoice_paid", { invoiceId: invoice.id, paypalInvoiceId: invoice.paypal_invoice_id, handle: invoice.buyer_handle, totalCents: invoice.total_cents });
}

async function markCancelled(invoice: InvoiceRow): Promise<void> {
  if (!markInvoiceCancelled(invoice)) return;
  event(invoice.sale_id, "invoice_cancelled", { invoiceId: invoice.id, paypalInvoiceId: invoice.paypal_invoice_id, handle: invoice.buyer_handle });
  await releaseBackups(invoice);
}

export async function reconcileInvoices(now = Date.now()): Promise<void> {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) return;
  for (const invoice of listDraftInvoices()) {
    try { await finishInvoice(invoice.id); }
    catch (error) { event(invoice.sale_id, "invoice_retry_failed", { invoiceId: invoice.id, message: error instanceof Error ? error.message : "Invoice retry failed" }); }
  }
  for (const sale of listSalesToClose(now)) {
    closeSale(sale.id);
    event(sale.id, "sale_closed", { reason: "claim_deadline", atMs: now });
    try { await closeAndInvoice(sale.id); } catch (error) { event(sale.id, "invoice_failed", { message: error instanceof Error ? error.message : "Invoice operation failed" }); }
  }
  for (const overdue of listOutstandingInvoices(now)) {
    const invoice = getInvoice(overdue.id);
    if (!invoice?.paypal_invoice_id) continue;
    try {
      const remote = await paypalRead(invoice.paypal_invoice_id);
      const transition = invoiceTransition(remote.status as "SENT" | "UNPAID" | "PAID" | "MARKED_AS_PAID" | "CANCELLED", now >= invoice.due_at_ms, nextBackup(invoiceItems(invoice.id)[0]?.id ?? "") !== undefined);
      if (transition.action === "mark_paid") await markPaid(invoice);
      else if (remote.status === "CANCELLED") await markCancelled(invoice);
      else if (transition.action === "cancel_invoice") {
        const op = addOperation("invoice_cancel", invoice.id, JSON.stringify({ invoiceId: invoice.paypal_invoice_id }));
        try {
          const cancelled = await paypalCancel(invoice.paypal_invoice_id, op.requestId);
          updateOperation("invoice_cancel", invoice.id, "SUCCEEDED", cancelled);
          await markCancelled(invoice);
        } catch (error) {
          const latest = await paypalRead(invoice.paypal_invoice_id);
          if (latest.status === "PAID") await markPaid(invoice);
          else if (latest.status === "CANCELLED") await markCancelled(invoice);
          else throw error;
        }
      }
    } catch (error) {
      event(invoice.sale_id, "reconcile_failed", { invoiceId: invoice.id, message: error instanceof Error ? error.message : "Invoice reconciliation failed" });
    }
  }
}

export async function handleInvoiceWebhook(paypalInvoiceId: string, eventType: string): Promise<void> {
  const invoice = getInvoiceByPayPal(paypalInvoiceId);
  if (!invoice) return;
  const remote = await paypalRead(paypalInvoiceId);
  if (remote.status === "PAID" || eventType === "INVOICING.INVOICE.PAID" && remote.status === "MARKED_AS_PAID") await markPaid(invoice);
  else if (remote.status === "CANCELLED" || eventType === "INVOICING.INVOICE.CANCELLED") await markCancelled(invoice);
}

export function claimQueue(saleId: string, itemId: string) {
  return listItemClaims(itemId).map((claim) => ({ handle: claim.handle, atMs: claim.at_ms, sequence: claim.sequence, kind: claim.kind }));
}

export function allInvoices(saleId: string) { return listInvoices(saleId); }
export function saleEvents(saleId: string) { return listEvents(saleId); }
export function saleBuyerClaims(saleId: string, handle: string) { return buyerClaims(saleId, handle); }
export function saleOpenItems(saleId: string) { return unclaimedItems(saleId); }
export function saleInvoices(saleId: string) { return listInvoices(saleId); }
export function salePublicBySlug(slug: string) { return publicSale(slug); }
export function saleSellerById(id: string) { return sellerSale(id); }
