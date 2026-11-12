import type { FeePolicy } from "./domain.js";

const apiBase = () => process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const approvalBase = () => process.env.PAYPAL_ENV === "live" ? "https://www.paypal.com" : "https://www.sandbox.paypal.com";

export class PayPalError extends Error {
  constructor(message: string, readonly status: number, readonly debugId: string | null, readonly details: unknown) {
    super(message);
  }
}

export interface InvoiceLine {
  title: string;
  amountCents: number;
}

export interface CreateInvoiceInput {
  email: string;
  lines: InvoiceLine[];
  shippingCents: number;
  currency: string;
  note: string;
  feePolicy: FeePolicy;
  minimumDueCents?: number | null;
}

export interface PayPalInvoice {
  id: string;
  status: string;
  payerUrl: string | null;
  transactionIds: string[];
}

export class MissingTransactionError extends Error {}

// Carrier codes from https://developer.paypal.com/docs/tracking/reference/carriers/ ; anything else goes as OTHER with its name.
const CARRIERS = new Set(["USPS", "UPS", "FEDEX", "ONTRAC"]);

export function trackerPayload(transactionId: string | null | undefined, carrier: string, trackingNumber: string) {
  if (!transactionId) throw new MissingTransactionError("PayPal shows no payment transaction for this invoice, so tracking has nothing to attach to");
  const code = carrier.trim().toUpperCase();
  return { trackers: [{
    transaction_id: transactionId, tracking_number: trackingNumber.trim(), status: "SHIPPED", notify_buyer: true,
    ...(CARRIERS.has(code) ? { carrier: code } : { carrier: "OTHER", carrier_name_other: carrier.trim() }),
  }] };
}

let cachedToken: { value: string; expiresAt: number } | undefined;
let tokenFlight: Promise<string> | undefined;

async function token(): Promise<string> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PayPal setup requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET");
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  if (tokenFlight) return tokenFlight;
  tokenFlight = (async () => {
    const response = await fetch(`${apiBase()}/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json() as { access_token?: string; expires_in?: number; error_description?: string };
    if (!response.ok || !body.access_token) throw new PayPalError(body.error_description ?? "PayPal OAuth failed", response.status, response.headers.get("paypal-debug-id"), body);
    cachedToken = { value: body.access_token, expiresAt: Date.now() + Math.max(1, (body.expires_in ?? 300) - 60) * 1000 };
    return body.access_token;
  })();
  try { return await tokenFlight; } finally { tokenFlight = undefined; }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const accessToken = await token();
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const debugId = response.headers.get("paypal-debug-id");
    console.error("PayPal API request failed", { status: response.status, debugId, path, details: body?.details ?? body?.errors });
    const nested = (body?.errors as Array<{ details?: Array<{ issue?: string }> }> | undefined)?.[0]?.details?.[0]?.issue;
    throw new PayPalError(String(body?.message ?? nested ?? `PayPal returned ${response.status}`), response.status, debugId, body?.details ?? body);
  }
  return body as T;
}

function invoiceFrom(body: Record<string, unknown>): PayPalInvoice {
  const links = Array.isArray(body.links) ? body.links as Array<{ rel?: string; href?: string }> : [];
  const detail = body.detail as { metadata?: { recipient_view_url?: string } } | undefined;
  const payerUrl = links.find((link) => link.rel === "payer-view")?.href ?? detail?.metadata?.recipient_view_url ?? null;
  const payments = body.payments as { transactions?: Array<{ payment_id?: string }> } | undefined;
  const transactionIds = (payments?.transactions ?? []).map((transaction) => transaction.payment_id).filter((id): id is string => !!id);
  return { id: String(body.id ?? ""), status: String(body.status ?? ""), payerUrl, transactionIds };
}

export async function createInvoice(input: CreateInvoiceInput, requestId: string): Promise<PayPalInvoice> {
  const items = input.lines.map((line) => ({ name: line.title.slice(0, 127), quantity: "1", unit_amount: { currency_code: input.currency, value: (line.amountCents / 100).toFixed(2) }, unit_of_measure: "QUANTITY" }));
  // PayPal US invoice fees are payment-method dependent. The default estimate follows the published 3.49% + $0.49 PayPal/Venmo invoicing rate: https://www.paypal.com/us/business/paypal-business-fees
  const payload = {
    detail: { currency_code: input.currency, note: input.note, payment_term: { term_type: "DUE_ON_RECEIPT" } },
    primary_recipients: [{ billing_info: { email_address: input.email } }],
    items,
    configuration: { allow_tip: false, partial_payment: input.minimumDueCents
      ? { allow_partial_payment: true, minimum_amount_due: { currency_code: input.currency, value: (input.minimumDueCents / 100).toFixed(2) } }
      : { allow_partial_payment: false } },
    amount: { breakdown: { shipping: { amount: { currency_code: input.currency, value: (input.shippingCents / 100).toFixed(2) } } } },
  };
  const created = await api<Record<string, unknown>>("/v2/invoicing/invoices", { method: "POST", headers: { Prefer: "return=representation", "PayPal-Request-Id": requestId }, body: JSON.stringify(payload) });
  const draft = invoiceFrom(created);
  if (!draft.id) throw new Error("PayPal created an invoice without returning an id");
  return draft;
}

export async function sendInvoice(invoiceId: string, requestId: string): Promise<PayPalInvoice> {
  await api<void>(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`, {
    method: "POST", headers: { "PayPal-Request-Id": requestId },
    body: JSON.stringify({ send_to_recipient: true, send_to_invoicer: false }),
  });
  const result = await readInvoice(invoiceId);
  if (!["SENT", "UNPAID", "PAID", "MARKED_AS_PAID"].includes(result.status)) throw new Error(`PayPal invoice read-back was ${result.status}, expected SENT, UNPAID, or PAID`);
  return result;
}

export async function readInvoice(invoiceId: string): Promise<PayPalInvoice> {
  const body = await api<Record<string, unknown>>(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
  return invoiceFrom(body);
}

export async function cancelInvoice(invoiceId: string, requestId: string): Promise<PayPalInvoice> {
  await api<void>(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/cancel`, {
    method: "POST", headers: { "PayPal-Request-Id": requestId },
    body: JSON.stringify({ send_to_recipient: true, send_to_invoicer: false, subject: "Claim sale invoice cancelled", note: "The payment deadline passed and this item has moved to the next claimant." }),
  });
  const result = await readInvoice(invoiceId);
  if (result.status !== "CANCELLED") throw new Error(`PayPal invoice read-back was ${result.status}, expected CANCELLED`);
  return result;
}

export async function addTracker(body: ReturnType<typeof trackerPayload>, requestId: string): Promise<{ id: string; status: string; transactionId: string }> {
  const [payload] = body.trackers;
  const id = `${payload.transaction_id}-${payload.tracking_number}`;
  let posted: unknown;
  try {
    const result = await api<{ errors?: Array<{ message?: string }> }>("/v1/shipping/trackers", { method: "POST", headers: { "PayPal-Request-Id": requestId }, body: JSON.stringify(body) });
    if (result?.errors?.length) posted = new Error(result.errors.map((error) => error.message).join("; "));
  } catch (error) { posted = error; }
  // The GET is the post-condition: a retry or duplicate POST still succeeds if PayPal holds this exact tracker.
  const tracker = await api<{ transaction_id?: string; status?: string }>(`/v1/shipping/trackers/${encodeURIComponent(id)}`).catch((error) => { throw posted ?? error; });
  if (tracker.transaction_id !== payload.transaction_id || tracker.status !== "SHIPPED") throw new Error(`PayPal tracker read-back was ${tracker.status ?? "missing"}, expected SHIPPED`);
  return { id, status: tracker.status, transactionId: tracker.transaction_id };
}

export async function remindInvoice(invoiceId: string, requestId: string): Promise<void> {
  await api<void>(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/remind`, {
    method: "POST", headers: { "PayPal-Request-Id": requestId }, body: JSON.stringify({ subject: "Payment reminder", note: "Your claim sale invoice is still awaiting payment." }),
  });
}

export async function verifyWebhook(body: unknown, headers: Headers): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const input = {
    auth_algo: headers.get("paypal-auth-algo"),
    cert_url: headers.get("paypal-cert-url"),
    transmission_id: headers.get("paypal-transmission-id"),
    transmission_sig: headers.get("paypal-transmission-sig"),
    transmission_time: headers.get("paypal-transmission-time"),
    webhook_id: webhookId,
    webhook_event: body,
  };
  if (Object.values(input).some((value) => !value)) return false;
  const result = await api<{ verification_status?: string }>("/v1/notifications/verify-webhook-signature", { method: "POST", body: JSON.stringify(input) });
  return result.verification_status === "SUCCESS";
}

export function payerBaseUrl(): string {
  return approvalBase();
}
