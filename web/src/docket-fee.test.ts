import { expect, it } from "vitest";
import { buildDocketRows, docketTotals } from "./docket-grid.tsx";

const item = (id: string, number: number, status: string) => ({ id, number, title: `Card ${number}`, price_cents: 2600, status });
const claim = (itemId: string, handle: string) => ({ item_id: itemId, handle, email: `${handle}@example.com`, at_ms: 1000, kind: "claim" });
// Split policy: PayPal fee estimate 1.43, buyer carries 0.72 of it on the invoice.
const invoice = (id: string, handle: string, itemId: string, status: string) => ({ id, buyer_handle: handle, buyer_email: `${handle}@example.com`, status, subtotal_cents: 2600, shipping_cents: 100, fee_cents: 143, total_cents: 2772, due_at_ms: 0, payer_url: null, items: [{ id: itemId }] });
it("the fee column and totals row show the fee line the buyer pays, so items + ship + fee = total", () => {
  const data = { items: [item("a", 1, "PAID")], claims: [claim("a", "alice")], invoices: [invoice("i1", "alice", "a", "PAID")], events: [] };
  const [row] = buildDocketRows(data);
  expect(row.fee).toBe(72);
  expect(row.subtotal + row.shipping + row.fee).toBe(row.total);
  const totals = docketTotals(data.invoices);
  expect(totals.subtotal + totals.shipping + totals.fee).toBe(totals.total);
});
