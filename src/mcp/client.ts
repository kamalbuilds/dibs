// Thin HTTP client for the existing Dibs API. Every rule (deadlines, duplicate claims, backup order,
// PayPal invoicing) stays on the server; this only shapes requests and surfaces its errors.

export type PublicItem = { id: string; number: number; title: string; setOrPlatform?: string | null; conditionNotes?: string | null; priceCents: number | null; status: string; photoUrl?: string | null; backupCount?: number };
export type PublicSale = { id: string; slug: string; title: string; status: string; closesAtMs: number; depositPercent?: number; items: PublicItem[] };
export type InvoiceRow = { id: string; sale_id?: string; buyer_handle: string; buyer_email: string; paypal_invoice_id?: string | null; payer_url: string | null; status: string; subtotal_cents: number; shipping_cents: number; fee_cents: number; total_cents: number; deposit_cents?: number | null; due_at_ms: number; created_at_ms?: number; items?: Array<{ id: string; number: number; title: string }>; shipment?: { carrier: string; tracking: string; paypal_tracker_id?: string | null } | null };
export type ClaimRow = { item_id: string; handle: string; email?: string; at_ms: number; kind: string; sequence: number };
export type SellerSale = { sale: { id: string; slug: string; title: string; status: string; closes_at_ms: number; fee_policy?: string; fee_rate_bp?: number; fee_fixed_cents?: number; invoice_mode?: string }; items: Array<{ id: string; number: number; title: string; price_cents: number | null; status: string; photoUrl?: string | null }>; claims: ClaimRow[]; invoices: InvoiceRow[]; events: Array<{ id: string; type: string; at_ms: number; item_id?: string | null; payload: string }> };
export type Money = { value: string; currency: string };
export type PaymentRequirement = { status: "payment_required" | "pending_invoice" | "paid" | "backup_waiting"; httpStatusEquivalent: number; amount: Money | null; amountDueNow: Money | null; invoiceId: string | null; paypalInvoiceId: string | null; payUrl: string | null; expiresAt: string | null; invoiceExpectedAt: string | null; message: string };
export type ClaimResponse = { claims: Array<{ itemId: string; handle: string; atMs: number; sequence: number; kind: "claim" | "backup"; position?: number }>; invoices: InvoiceRow[]; payment?: PaymentRequirement; replayed?: boolean };
export type Receipt = { invoice: { id: string; buyerHandle: string; status: string; subtotalCents: number; shippingCents: number; feeCents: number; totalCents: number; depositCents?: number | null; payerUrl: string | null; dueAtMs?: number }; items: Array<{ number: number; title: string; price_cents: number }>; shipment?: { carrier: string; tracking: string; paypal_tracker_id?: string | null } | null };

export type RefreshedReceipt = Receipt & { refresh: { checkedPayPal: boolean; remoteStatus: string | null; atMs: number; reason: string | null } };

export class DibsApiError extends Error {
  constructor(message: string, readonly status: number, readonly path: string) { super(message); }
}

export const DEFAULT_BASE_URL = "https://dibs-claims.fly.dev";

export class DibsClient {
  readonly baseUrl: string;
  constructor(baseUrl = process.env.DIBS_BASE_URL || DEFAULT_BASE_URL, private readonly fetchImpl: typeof fetch = fetch, readonly sellerKey: string | null = process.env.DIBS_SELLER_KEY || null) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async request<T>(path: string, init: RequestInit = {}, sellerKey?: string): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body) headers.set("content-type", "application/json");
    if (sellerKey) headers.set("x-seller-key", sellerKey);
    let response: Response;
    try { response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers }); }
    catch (error) { throw new DibsApiError(`Could not reach Dibs at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`, 0, path); }
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      throw new DibsApiError(body.error || `Dibs returned HTTP ${response.status}${retryAfter ? `; retry after ${retryAfter}s` : ""}`, response.status, path);
    }
    return body as T;
  }

  publicSale(slug: string) { return this.request<PublicSale>(`/api/public/sales/${encodeURIComponent(slug)}`); }
  sellerSale(saleId: string, key: string) { return this.request<SellerSale>(`/api/sales/${encodeURIComponent(saleId)}`, {}, key); }
  claim(saleId: string, body: { handle: string; email: string; itemIds?: string[]; text?: string; hold?: boolean }) {
    return this.request<ClaimResponse>(`/api/sales/${encodeURIComponent(saleId)}/claims`, { method: "POST", body: JSON.stringify(body) });
  }
  receipt(invoiceId: string) { return this.request<Receipt>(`/api/receipts/${encodeURIComponent(invoiceId)}`); }
  // Asks Dibs to read this invoice from PayPal now (throttled server-side); falls back to the stored receipt on older servers.
  async refreshInvoice(invoiceId: string): Promise<RefreshedReceipt> {
    try { return await this.request<RefreshedReceipt>(`/api/invoices/${encodeURIComponent(invoiceId)}/refresh`, { method: "POST" }); }
    catch (error) {
      if (error instanceof DibsApiError && error.status === 404 && error.message !== "Receipt not found") return { ...(await this.receipt(invoiceId)), refresh: { checkedPayPal: false, remoteStatus: null, atMs: Date.now(), reason: "server_without_refresh" } };
      throw error;
    }
  }
  saleUrl(slug: string) { return `${this.baseUrl}/s/${slug}`; }
  absolute(path: string | null | undefined) { return path ? (path.startsWith("http") ? path : `${this.baseUrl}${path}`) : null; }
}

// Accepts a slug ("kJ4emW4"), a sale link ("https://dibs-claims.fly.dev/s/kJ4emW4") or "/s/kJ4emW4".
export function parseSaleRef(ref: string): string {
  const trimmed = ref.trim();
  const match = trimmed.match(/\/s\/([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) return trimmed;
  throw new DibsApiError(`"${ref}" is not a Dibs sale link or slug. Use the slug from /s/<slug>, e.g. kJ4emW4.`, 400, "parseSaleRef");
}
