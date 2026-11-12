// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

const sale = { id: "sale2", slug: "binder2", title: "First-claim binder", status: "OPEN", closes_at_ms: Date.now() + 300_000 };
const item = (status: string) => ({ id: "item1", number: 1, title: "Irene Adler", price_cents: 2600, status });
const invoice = (status: string) => ({ id: "inv-1", paypal_invoice_id: "INV2-TEST", buyer_handle: "alice", buyer_email: "alice@example.com", status, subtotal_cents: 2600, shipping_cents: 100, fee_cents: 76, total_cents: 2776, due_at_ms: Date.now() + 86_400_000, payer_url: "https://www.sandbox.paypal.com/invoice/p/#INV2-TEST", items: [item("INVOICED")] });
const claims = [{ item_id: "item1", handle: "alice", email: "alice@example.com", at_ms: 1000, kind: "claim", sequence: 1 }];
const sent = { sale, items: [item("INVOICED")], claims, invoices: [invoice("SENT")], events: [] };
const paid = { ...sent, items: [item("PAID")], invoices: [invoice("PAID")] };

it("flips the docket row to SOLD on invoice_paid without a manual refresh, and announces it", async () => {
  let state: unknown = sent;
  const listeners = new Map<string, (event: MessageEvent) => void>();
  vi.stubGlobal("EventSource", class { static CLOSED = 2; readyState = 1; onopen: (() => void) | null = null; onerror = null; constructor() { setTimeout(() => this.onopen?.(), 0); } addEventListener(type: string, fn: (event: MessageEvent) => void) { listeners.set(type, fn); } close() {} });
  vi.stubGlobal("fetch", async (path: string) => new Response(JSON.stringify(path === "/api/sales/sale2" ? state : { missing: [] })));
  localStorage.setItem("dibs-owner:sale2", "k");
  document.body.innerHTML = '<div id="root"></div>';
  history.pushState(null, "", "/dash/sale2");
  await import("./main.tsx");

  const status = () => document.querySelector('.ag-center-cols-container .ag-row[row-index="0"] [col-id="status"]')?.textContent ?? null;
  await vi.waitFor(() => expect(status()).toBe("Invoiced"), { timeout: 15000 });
  expect(document.querySelector(".sold-note")?.textContent).toBe("");

  state = paid;
  listeners.get("invoice_paid")!(new MessageEvent("invoice_paid", { data: "{}" }));
  await vi.waitFor(() => expect(status()).toBe("Sold · paid"), { timeout: 15000 });
  await vi.waitFor(() => expect(document.querySelector(".sold-note")?.textContent).toContain("#01 Irene Adler sold to @alice"), { timeout: 5000 });
  expect(document.querySelector(".ag-center-cols-container .ag-row.row-sold")).not.toBeNull();
}, 40000);
