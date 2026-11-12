import { expect, it } from "vitest";
import { buildDocketRows, buyersToInvoice } from "./docket-grid.tsx";

const item = (id: string, number: number, status: string) => ({ id, number, title: `Card ${number}`, price_cents: 2600, status });
const claim = (itemId: string, handle: string) => ({ item_id: itemId, handle, email: `${handle}@example.com`, at_ms: 1000, kind: "claim" });
// Split policy: PayPal fee estimate 1.43, buyer carries 0.72 of it on the invoice.
const invoice = (id: string, handle: string, itemId: string, status: string) => ({ id, buyer_handle: handle, buyer_email: `${handle}@example.com`, status, subtotal_cents: 2600, shipping_cents: 0, fee_cents: 143, total_cents: 2772, due_at_ms: 0, payer_url: null, items: [{ id: itemId }] });

it("counts only buyers still waiting for an invoice", () => {
  const data = {
    items: [item("a", 1, "PAID"), item("b", 2, "INVOICED"), item("c", 3, "INVOICED"), item("d", 4, "CLAIMED"), item("e", 5, "CLAIMED")],
    claims: [claim("a", "alice"), claim("b", "bob"), claim("c", "cara"), claim("d", "dan"), claim("e", "Dan")],
    invoices: [invoice("i1", "alice", "a", "PAID"), invoice("i2", "bob", "b", "SENT"), invoice("i3", "cara", "c", "HELD")],
    events: [],
  };
  expect(buyersToInvoice(buildDocketRows(data))).toBe(1);
});
