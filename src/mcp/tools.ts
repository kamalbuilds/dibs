import { DibsApiError, parseSaleRef, type ClaimResponse, type DibsClient, type InvoiceRow, type PaymentRequirement, type PublicSale, type RefreshedReceipt, type SellerSale } from "./client.js";

// Each tool returns structured data (for the model to reason over) plus one readable summary (for the human).
export type ToolResult<T> = { data: T; text: string };

const usd = (cents: number | null | undefined) => cents == null ? "unpriced" : `$${(cents / 100).toFixed(2)}`;
const pocket = (n: number) => `#${String(n).padStart(2, "0")}`;
const iso = (ms: number) => new Date(ms).toISOString();
const at = (handle: string) => handle.startsWith("@") ? handle : `@${handle}`;
const sameHandle = (a: string, b: string) => a.replace(/^@/, "").toLowerCase() === b.replace(/^@/, "").toLowerCase();
const UNPAID = new Set(["DRAFT", "SENT", "UNPAID", "HELD", "PARTIALLY_PAID"]);
const FEE_POLICY: Record<string, string> = { seller_absorbs: "seller covers the PayPal G&S fee", split: "PayPal G&S fee split between buyer and seller", buyer_pays: "buyer covers the PayPal G&S fee" };

// Remembers invoice ids this MCP session saw in claim results, so invoice_status works by handle without a seller key.
export class SessionMemory {
  private invoices = new Map<string, string[]>();
  remember(saleId: string, handle: string, invoiceIds: string[]) {
    const key = `${saleId}:${handle.replace(/^@/, "").toLowerCase()}`;
    this.invoices.set(key, [...new Set([...(this.invoices.get(key) ?? []), ...invoiceIds])]);
  }
  recall(saleId: string, handle: string) { return this.invoices.get(`${saleId}:${handle.replace(/^@/, "").toLowerCase()}`) ?? []; }
}

export type ListSaleData = {
  sale: { id: string; slug: string; title: string; status: string; url: string; closesAt: string; closesAtMs: number; depositPercent: number | null };
  items: Array<{ number: number; title: string; details: string | null; priceCents: number | null; price: string; status: string; claimable: boolean; claimedBy: string | null; claimedAt: string | null; backupCount: number; backupQueue: Array<{ handle: string; at: string }> | null; photoUrl: string | null }>;
  counts: { total: number; open: number; claimed: number; invoiced: number; paid: number };
  queueVisibility: "public" | "seller";
};

export async function listSale(client: DibsClient, input: { sale: string; sellerKey?: string }): Promise<ToolResult<ListSaleData>> {
  const sale = await client.publicSale(parseSaleRef(input.sale));
  const key = input.sellerKey || client.sellerKey;
  let seller: SellerSale | null = null;
  if (key) { try { seller = await client.sellerSale(sale.id, key); } catch (error) { if (!(error instanceof DibsApiError) || error.status !== 401) throw error; } }
  const items = sale.items.map((item) => {
    const queue = seller ? seller.claims.filter((claim) => claim.item_id === item.id) : null;
    const claimable = sale.status === "OPEN" && (item.status === "OPEN" || item.status === "CLAIMED");
    return {
      number: item.number, title: item.title, details: [item.setOrPlatform, item.conditionNotes].filter(Boolean).join(" · ") || null,
      priceCents: item.priceCents, price: usd(item.priceCents), status: item.status, claimable,
      claimedBy: queue?.[0] ? at(queue[0].handle) : null, claimedAt: queue?.[0] ? iso(queue[0].at_ms) : null,
      backupCount: queue ? Math.max(0, queue.length - 1) : item.backupCount ?? 0,
      backupQueue: queue ? queue.slice(1).map((claim) => ({ handle: at(claim.handle), at: iso(claim.at_ms) })) : null,
      photoUrl: client.absolute(item.photoUrl),
    };
  });
  const count = (statuses: string[]) => items.filter((item) => statuses.includes(item.status)).length;
  const data: ListSaleData = {
    sale: { id: sale.id, slug: sale.slug, title: sale.title, status: sale.status, url: client.saleUrl(sale.slug), closesAt: iso(sale.closesAtMs), closesAtMs: sale.closesAtMs, depositPercent: sale.depositPercent ?? null },
    items, counts: { total: items.length, open: count(["OPEN"]), claimed: count(["CLAIMED"]), invoiced: count(["INVOICED"]), paid: count(["PAID", "SHIPPED"]) },
    queueVisibility: seller ? "seller" : "public",
  };
  const lines = items.map((item) => `${pocket(item.number)} ${item.title} · ${item.price} · ${item.status}${item.claimedBy ? ` by ${item.claimedBy}` : ""}${item.backupCount ? ` · ${item.backupCount} backup${item.backupCount === 1 ? "" : "s"}` : ""}`);
  const text = [`${sale.title} (${data.sale.url})`, `${sale.status === "OPEN" ? "Claims open" : "Sale closed"} until ${data.sale.closesAt}. ${data.counts.open} of ${data.counts.total} pockets open.`, ...lines,
    seller ? "Backup queues shown with handles (seller key)." : "Buyer handles are private; backup counts only."].join("\n");
  return { data, text };
}

export type ClaimData = {
  sale: { id: string; slug: string; title: string; url: string; closesAt: string };
  handle: string; email: string; hold: boolean; retried: boolean;
  payment: PaymentRequirement;
  results: Array<{ number: number; title: string; priceCents: number | null; outcome: "first" | "backup"; position: number; label: string; serverTimestamp: string; serverTimestampMs: number }>;
  invoices: Array<{ invoiceId: string; status: string; totalCents: number; total: string; feeCents: number; shippingCents: number; depositCents: number | null; dueAt: string; payUrl: string | null; receiptUrl: string }>;
  nextSteps: string[];
};

export async function claim(client: DibsClient, memory: SessionMemory, input: { sale: string; itemNumbers?: number[]; commentText?: string; handle: string; email: string; deposit?: boolean }): Promise<ToolResult<ClaimData>> {
  const sale = await client.publicSale(parseSaleRef(input.sale));
  const handle = input.handle.trim().replace(/^@/, "");
  let body: { handle: string; email: string; itemIds?: string[]; text?: string; hold?: boolean };
  if (input.itemNumbers?.length) {
    const unknown = input.itemNumbers.filter((n) => !sale.items.some((item) => item.number === n));
    if (unknown.length) throw new DibsApiError(`Pocket ${unknown.map(pocket).join(", ")} is not in "${sale.title}" (it has #01 to ${pocket(Math.max(...sale.items.map((item) => item.number)))}).`, 400, "claim");
    body = { handle, email: input.email, itemIds: input.itemNumbers.map((n) => sale.items.find((item) => item.number === n)!.id), hold: input.deposit || undefined };
  } else if (input.commentText?.trim()) {
    body = { handle, email: input.email, text: input.commentText.trim(), hold: input.deposit || undefined };
  } else throw new DibsApiError("Give itemNumbers (e.g. [3, 7]) or commentText (e.g. \"mine 3 and 7\").", 400, "claim");

  const result: ClaimResponse = await client.claim(sale.id, body);
  const after = await client.publicSale(sale.slug).catch(() => sale);
  const results = result.claims.map((entry) => {
    const item = after.items.find((row) => row.id === entry.itemId) ?? sale.items.find((row) => row.id === entry.itemId)!;
    // Newer Dibs servers report the claim's place in the item queue; older ones only expose the backup count.
    const position = entry.kind === "backup" ? Math.max(1, entry.position ?? after.items.find((row) => row.id === entry.itemId)?.backupCount ?? 1) : 0;
    return { number: item.number, title: item.title, priceCents: item.priceCents, outcome: entry.kind === "claim" ? "first" as const : "backup" as const, position, label: entry.kind === "claim" ? "First" : `Backup ${position}`, serverTimestamp: iso(entry.atMs), serverTimestampMs: entry.atMs };
  });
  const invoices = result.invoices.filter((invoice) => invoice.status !== "CANCELLED").map((invoice) => ({ invoiceId: invoice.id, status: invoice.status, totalCents: invoice.total_cents, total: usd(invoice.total_cents), feeCents: invoice.fee_cents, shippingCents: invoice.shipping_cents, depositCents: invoice.deposit_cents ?? null, dueAt: iso(invoice.due_at_ms), payUrl: invoice.payer_url, receiptUrl: `${client.baseUrl}/receipt/${invoice.id}` }));
  memory.remember(sale.id, handle, invoices.map((invoice) => invoice.invoiceId));
  const payment = result.payment ?? derivePayment(results, result.invoices, sale);
  const won = results.filter((row) => row.outcome === "first");
  const nextSteps: string[] = [];
  if (invoices.some((invoice) => invoice.payUrl)) nextSteps.push(`PayPal has emailed a Goods & Services invoice to ${input.email}. Pay it before the due time or the item rolls to the next backup.`);
  else if (won.length) nextSteps.push(`One PayPal Goods & Services invoice for all your pockets goes to ${input.email} when the seller closes the sale (claims close ${iso(sale.closesAtMs)}). Shipping and the fee line are added there.`);
  if (results.some((row) => row.outcome === "backup")) nextSteps.push("You are in a backup line: if the buyer ahead of you passes or does not pay in time, Dibs cancels their invoice and PayPal invoices you automatically.");
  if (input.deposit) nextSteps.push(`You asked to hold with a ${sale.depositPercent ?? 20}% deposit; the invoice allows a partial payment that keeps the item held.`);
  nextSteps.push(payment.status === "payment_required" ? "After paying, call await_payment to confirm PAID (it reads PayPal on demand)." : "Check progress any time with invoice_status.");
  const data: ClaimData = { sale: { id: sale.id, slug: sale.slug, title: sale.title, url: client.saleUrl(sale.slug), closesAt: iso(sale.closesAtMs) }, handle: at(handle), email: input.email, hold: !!input.deposit, retried: !!result.replayed, payment, results, invoices, nextSteps };
  const text = [result.replayed ? `Already claimed: ${at(handle)} claimed this earlier on "${sale.title}". Nothing new was claimed; this is the original result.` : `Claim received for ${at(handle)} on "${sale.title}".`, ...results.map((row) => `${pocket(row.number)} ${row.title} (${usd(row.priceCents)}): ${row.label} · server time ${row.serverTimestamp}`), ...invoices.map((invoice) => `PayPal invoice ${invoice.invoiceId}: ${invoice.status}, ${invoice.total}, due ${invoice.dueAt}${invoice.payUrl ? `, pay at ${invoice.payUrl}` : ""}`), paymentLine(payment), "Next:", ...nextSteps.map((step) => `- ${step}`)].join("\n");
  return { data, text };
}

// Older Dibs servers do not send `payment`; build the same 402-style summary from their invoice rows (never invented).
function derivePayment(results: ClaimData["results"], rows: InvoiceRow[], sale: PublicSale): PaymentRequirement {
  const base = { amount: null, amountDueNow: null, invoiceId: null, paypalInvoiceId: null, payUrl: null, expiresAt: null, invoiceExpectedAt: null };
  if (!results.some((row) => row.outcome === "first")) return { ...base, status: "backup_waiting", httpStatusEquivalent: 202, message: "You are a backup. Nothing to pay unless the buyer ahead passes; then Dibs sends you a PayPal invoice." };
  const money = (cents: number) => ({ value: (cents / 100).toFixed(2), currency: "USD" });
  const open = rows.find((row) => ["SENT", "UNPAID", "HELD"].includes(row.status) && row.payer_url);
  if (open) return { ...base, status: "payment_required", httpStatusEquivalent: 402, amount: money(open.total_cents), amountDueNow: money(open.deposit_cents && open.status !== "HELD" ? open.deposit_cents : open.total_cents), invoiceId: open.id, paypalInvoiceId: open.paypal_invoice_id ?? null, payUrl: open.payer_url, expiresAt: iso(open.due_at_ms), message: "Pay the PayPal Goods & Services invoice before it expires, or the item rolls to the next backup." };
  return { ...base, status: "pending_invoice", httpStatusEquivalent: 202, invoiceExpectedAt: iso(sale.closesAtMs), message: "No invoice yet: PayPal invoices go out when claims close, or right after a first claim, depending on the sale." };
}

function paymentLine(payment: PaymentRequirement): string {
  switch (payment.status) {
    case "payment_required": return `402-style payment required: ${payment.amount!.value} ${payment.amount!.currency}${payment.amountDueNow && payment.amountDueNow.value !== payment.amount!.value ? ` (${payment.amountDueNow.value} due now)` : ""} on PayPal invoice ${payment.paypalInvoiceId ?? payment.invoiceId}, pay at ${payment.payUrl}, expires ${payment.expiresAt}. Then call await_payment.`;
    case "pending_invoice": return `Payment pending_invoice: ${payment.message}${payment.invoiceExpectedAt ? ` Expected by ${payment.invoiceExpectedAt}.` : ""}`;
    case "paid": return `Payment: paid (${payment.amount?.value} ${payment.amount?.currency}).`;
    default: return `Payment: ${payment.status}. ${payment.message}`;
  }
}

export type AwaitPaymentData = {
  invoiceId: string; buyer: string; finalStatus: string; outcome: "paid" | "cancelled" | "timeout"; state: string;
  amount: { value: string; currency: string }; payUrl: string | null; polls: number; paypalChecks: number; elapsedSeconds: number; timedOut: boolean;
  history: Array<{ at: string; status: string; checkedPayPal: boolean }>;
};

const FINAL = new Set(["PAID", "MARKED_AS_PAID", "CANCELLED"]);

// Polls Dibs' on-demand PayPal refresh until the invoice is PAID or CANCELLED, or the timeout passes.
export async function awaitPayment(client: DibsClient, memory: SessionMemory, input: { invoiceId?: string; sale?: string; handle?: string; timeoutSeconds?: number; intervalSeconds?: number },
  options: { sleep?: (ms: number) => Promise<void>; now?: () => number; onPoll?: (poll: number, status: string, elapsedMs: number, timeoutMs: number) => Promise<void> | void } = {}): Promise<ToolResult<AwaitPaymentData>> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  let invoiceId = input.invoiceId;
  if (!invoiceId && input.sale && input.handle) {
    const sale = await client.publicSale(parseSaleRef(input.sale));
    invoiceId = memory.recall(sale.id, input.handle).at(-1);
  }
  if (!invoiceId) throw new DibsApiError("Give the invoiceId from the claim result (payment.invoiceId), or the sale and handle used to claim in this session.", 400, "await_payment");
  const timeoutMs = Math.round((input.timeoutSeconds ?? 120) * 1000);
  const intervalMs = Math.round((input.intervalSeconds ?? 4) * 1000);
  const started = now();
  const history: AwaitPaymentData["history"] = [];
  let latest: RefreshedReceipt;
  let paypalChecks = 0;
  for (;;) {
    latest = await client.refreshInvoice(invoiceId);
    if (latest.refresh.checkedPayPal) paypalChecks += 1;
    history.push({ at: iso(now()), status: latest.invoice.status, checkedPayPal: latest.refresh.checkedPayPal });
    await options.onPoll?.(history.length, latest.invoice.status, now() - started, timeoutMs);
    const remainingMs = timeoutMs - (now() - started);
    if (FINAL.has(latest.invoice.status) || remainingMs <= 0) break;
    await sleep(Math.min(intervalMs, remainingMs));
  }
  const status = latest.invoice.status;
  const outcome = status === "CANCELLED" ? "cancelled" : FINAL.has(status) ? "paid" : "timeout";
  const elapsedSeconds = Math.round((now() - started) / 1000);
  const data: AwaitPaymentData = { invoiceId, buyer: at(latest.invoice.buyerHandle), finalStatus: status, outcome, state: describeState(status, latest.invoice.dueAtMs ?? null), amount: { value: (latest.invoice.totalCents / 100).toFixed(2), currency: "USD" }, payUrl: latest.invoice.payerUrl, polls: history.length, paypalChecks, elapsedSeconds, timedOut: outcome === "timeout", history: history.slice(-10) };
  const text = outcome === "paid" ? `PAID: invoice ${invoiceId} for ${data.buyer}, ${data.amount.value} USD. ${data.state}. Confirmed after ${elapsedSeconds}s (${paypalChecks} PayPal read${paypalChecks === 1 ? "" : "s"}).`
    : outcome === "cancelled" ? `CANCELLED: invoice ${invoiceId} for ${data.buyer} was cancelled; the item passed to the next backup.`
    : `Still ${status} after ${elapsedSeconds}s: invoice ${invoiceId} for ${data.buyer}, ${data.amount.value} USD.${data.payUrl ? ` Pay at ${data.payUrl}.` : ""} Call await_payment again to keep waiting.`;
  return { data, text };
}

export type InvoiceStatusData = {
  source: "receipt" | "seller" | "public";
  invoices: Array<{ invoiceId: string; buyer: string; status: string; state: string; items: Array<{ number: number; title: string; priceCents: number }>; subtotalCents: number; shippingCents: number; feeCents: number; totalCents: number; total: string; depositCents: number | null; feePolicy: string | null; dueAt: string | null; payUrl: string | null; receiptUrl: string; shipment: { carrier: string; tracking: string; onPayPal: boolean } | null }>;
  rollover: Array<{ number: number; title: string; note: string }>;
  pending: Array<{ number: number; title: string; status: string; note: string }>;
  message: string;
};

function describeState(status: string, dueAtMs: number | null): string {
  switch (status) {
    case "DRAFT": return "Being drafted on PayPal";
    case "SENT": case "UNPAID": return `Sent by PayPal, awaiting payment${dueAtMs ? `; rolls to the next backup if unpaid by ${iso(dueAtMs)}` : ""}`;
    case "HELD": case "PARTIALLY_PAID": return "Deposit paid on PayPal; item is held until the balance is paid";
    case "PAID": case "MARKED_AS_PAID": return "Paid on PayPal";
    case "CANCELLED": return "Cancelled; the item passed to the next backup";
    case "FAILED": return "PayPal invoice failed; the seller can retry";
    default: return status;
  }
}

export async function invoiceStatus(client: DibsClient, memory: SessionMemory, input: { invoiceId?: string; sale?: string; handle?: string; email?: string; sellerKey?: string }): Promise<ToolResult<InvoiceStatusData>> {
  const fromReceipt = async (ids: string[], source: "receipt" | "public" = "receipt") => {
    const receipts = await Promise.all(ids.map((id) => client.receipt(id)));
    return receipts.map((r) => ({ invoiceId: r.invoice.id, buyer: at(r.invoice.buyerHandle), status: r.invoice.status, state: describeState(r.invoice.status, null), items: r.items.map((item) => ({ number: item.number, title: item.title, priceCents: item.price_cents })), subtotalCents: r.invoice.subtotalCents, shippingCents: r.invoice.shippingCents, feeCents: r.invoice.feeCents, totalCents: r.invoice.totalCents, total: usd(r.invoice.totalCents), depositCents: r.invoice.depositCents ?? null, feePolicy: null, dueAt: null, payUrl: r.invoice.payerUrl, receiptUrl: `${client.baseUrl}/receipt/${r.invoice.id}`, shipment: r.shipment ? { carrier: r.shipment.carrier, tracking: r.shipment.tracking, onPayPal: !!r.shipment.paypal_tracker_id } : null }));
  };
  const render = (data: InvoiceStatusData): ToolResult<InvoiceStatusData> => ({ data, text: [data.message, ...data.invoices.map((invoice) => `Invoice ${invoice.invoiceId} for ${invoice.buyer}: ${invoice.status}, ${invoice.total} (items ${usd(invoice.subtotalCents)} + shipping ${usd(invoice.shippingCents)} + fee ${usd(invoice.feeCents)})${invoice.depositCents ? `, deposit ${usd(invoice.depositCents)}` : ""}. ${invoice.state}.${invoice.feePolicy ? ` Fee: ${invoice.feePolicy}.` : ""}${invoice.payUrl ? ` PayPal invoice: ${invoice.payUrl}` : ""}${invoice.shipment ? ` Shipped ${invoice.shipment.carrier} ${invoice.shipment.tracking}${invoice.shipment.onPayPal ? " (tracking on PayPal)" : ""}.` : ""}`), ...data.rollover.map((row) => `${pocket(row.number)} ${row.title}: ${row.note}`), ...data.pending.map((row) => `${pocket(row.number)} ${row.title}: ${row.note}`)].join("\n") });

  if (input.invoiceId) {
    const invoices = await fromReceipt([input.invoiceId]);
    return render({ source: "receipt", invoices, rollover: [], pending: [], message: `PayPal invoice status for ${invoices[0].buyer}.` });
  }
  if (!input.sale || !(input.handle || input.email)) throw new DibsApiError("Give an invoiceId, or a sale plus the buyer's handle or email.", 400, "invoice_status");
  const sale: PublicSale = await client.publicSale(parseSaleRef(input.sale));
  const key = input.sellerKey || client.sellerKey;
  const matches = (invoice: Pick<InvoiceRow, "buyer_handle" | "buyer_email">) => (input.handle ? sameHandle(invoice.buyer_handle, input.handle) : true) && (input.email ? invoice.buyer_email.toLowerCase() === input.email.toLowerCase() : true);

  if (key) {
    const seller = await client.sellerSale(sale.id, key);
    const mine = seller.invoices.filter(matches);
    const feePolicy = seller.sale.fee_policy ? FEE_POLICY[seller.sale.fee_policy] ?? seller.sale.fee_policy : null;
    const invoices = mine.filter((invoice) => invoice.status !== "CANCELLED").map((invoice) => ({ invoiceId: invoice.id, buyer: at(invoice.buyer_handle), status: invoice.status, state: describeState(invoice.status, UNPAID.has(invoice.status) ? invoice.due_at_ms : null), items: (invoice.items ?? []).map((item) => ({ number: item.number, title: item.title, priceCents: (seller.items.find((row) => row.id === item.id)?.price_cents) ?? 0 })), subtotalCents: invoice.subtotal_cents, shippingCents: invoice.shipping_cents, feeCents: invoice.fee_cents, totalCents: invoice.total_cents, total: usd(invoice.total_cents), depositCents: invoice.deposit_cents ?? null, feePolicy, dueAt: UNPAID.has(invoice.status) ? iso(invoice.due_at_ms) : null, payUrl: invoice.payer_url, receiptUrl: `${client.baseUrl}/receipt/${invoice.id}`, shipment: invoice.shipment ? { carrier: invoice.shipment.carrier, tracking: invoice.shipment.tracking, onPayPal: !!invoice.shipment.paypal_tracker_id } : null }));
    const rollover = mine.filter((invoice) => invoice.status === "CANCELLED").flatMap((invoice) => (invoice.items ?? []).map((item) => {
      const next = seller.claims.filter((claim) => claim.item_id === item.id && !sameHandle(claim.handle, invoice.buyer_handle))[0];
      return { number: item.number, title: item.title, note: next ? `Invoice cancelled; rolled to backup ${at(next.handle)}` : "Invoice cancelled; no backup, item reopened" };
    }));
    const invoicedItems = new Set(seller.invoices.flatMap((invoice) => invoice.status === "CANCELLED" ? [] : (invoice.items ?? []).map((item) => item.id)));
    const pending = seller.claims.filter((claim) => matches({ buyer_handle: claim.handle, buyer_email: claim.email ?? "" }) && !invoicedItems.has(claim.item_id)).map((claim) => {
      const item = seller.items.find((row) => row.id === claim.item_id)!;
      const line = seller.claims.filter((row) => row.item_id === claim.item_id);
      const position = line.findIndex((row) => sameHandle(row.handle, claim.handle));
      return { number: item.number, title: item.title, status: position === 0 ? "first" : `backup ${position}`, note: position === 0 ? `Claimed first; PayPal invoice goes out when the seller closes the sale (${iso(seller.sale.closes_at_ms)})` : `Backup ${position}; invoiced automatically if everyone ahead passes` };
    });
    const who = input.handle ? at(input.handle) : input.email!;
    return render({ source: "seller", invoices, rollover, pending, message: invoices.length || rollover.length || pending.length ? `Status for ${who} on "${sale.title}".` : `No claims or invoices for ${who} on "${sale.title}".` });
  }

  const remembered = input.handle ? memory.recall(sale.id, input.handle) : [];
  if (remembered.length) {
    const invoices = await fromReceipt(remembered, "public");
    return render({ source: "public", invoices, rollover: [], pending: [], message: `Invoices this session saw for ${at(input.handle!)}.` });
  }
  return render({ source: "public", invoices: [], rollover: [], pending: [], message: `No invoice id is known for ${input.handle ? at(input.handle) : input.email} yet. On "${sale.title}" PayPal invoices go out when the seller closes the sale (claims close ${iso(sale.closesAtMs)}) or right after a first claim, depending on the sale; the PayPal email and the Dibs receipt link carry the invoice id. Pass invoiceId, or run with DIBS_SELLER_KEY for the seller view.` });
}
