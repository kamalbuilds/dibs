import { expect, it } from "vitest";
import { describeEvent, type TimelinePart } from "./format.ts";

const invoices = [{ id: "inv-b", buyer_handle: "qa_watson", total_cents: 1300, paypal_invoice_id: "INV2-9DAE-Z3JP-W8RL-CANQ", payer_url: "https://www.sandbox.paypal.com/invoice/p/#INV29DAEZ3JPW8RLCANQ" }];
const items = [{ id: "item1", number: 1 }];
const text = (parts: TimelinePart[]) => parts.map((part) => typeof part === "string" ? part : `[${part.id}]`).join("");
const ev = (type: string, payload: unknown, item_id: string | null = null) => ({ type, payload: JSON.stringify(payload), item_id });

it("names the buyer, amount and linked PayPal id for a sent invoice whose payload has no handle", () => {
  const parts = describeEvent(ev("invoice_sent", { invoiceId: "inv-b", paypalInvoiceId: "INV2-9DAE-Z3JP-W8RL-CANQ", status: "SENT", payerUrl: "https://www.sandbox.paypal.com/invoice/p/#INV29DAEZ3JPW8RLCANQ", totalCents: 1300 }), invoices, items);
  expect(text(parts)).toBe("Invoice [INV2-9DAE-Z3JP-W8RL-CANQ] sent to @qa_watson, $13.00");
  expect(parts[1]).toEqual({ id: "INV2-9DAE-Z3JP-W8RL-CANQ", href: "https://www.sandbox.paypal.com/invoice/p/#INV29DAEZ3JPW8RLCANQ" });
});

it("reads claims, passes and promotions as sentences with pocket numbers", () => {
  expect(text(describeEvent(ev("claim_received", { handle: "qa_holmes", atMs: 1, sequence: 1, source: "web" }, "item1"), invoices, items))).toBe("@qa_holmes claimed #01");
  expect(text(describeEvent(ev("invoice_cancelled", { invoiceId: "inv-b", paypalInvoiceId: "INV2-9DAE-Z3JP-W8RL-CANQ", handle: "qa_watson" }), invoices, items))).toBe("Invoice [INV2-9DAE-Z3JP-W8RL-CANQ] to @qa_watson cancelled; item passes to the backup line");
  expect(text(describeEvent(ev("backup_promoted", { handle: "qa_watson", atMs: 2 }, "item1"), invoices, items))).toBe("@qa_watson moved up from backup on #01");
});

it("never prints raw JSON, even for an unknown type or a broken payload", () => {
  expect(text(describeEvent({ type: "something_new", payload: "{not json", item_id: null }, invoices, items))).toBe("something new");
  for (const type of ["invoice_started", "invoice_paid", "deposit_held", "invoice_failed", "item_reopened", "sale_published"]) {
    expect(text(describeEvent(ev(type, { invoiceId: "inv-b", handle: "qa_watson", items: [1], itemNumber: 1, itemCount: 3, closesAtMs: 0, depositCents: 260, message: "x" }), invoices, items))).not.toMatch(/[{}"]/);
  }
});
