import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { depositCents, feeLineTitle, invoiceTransition } from "./domain.js";
import { MissingTransactionError, trackerPayload } from "./paypal.js";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "dibs-money-"));
const { addSaleItem, createNewSale, publish, submitClaims } = await import("./service.js");
const { createInvoice, getInvoice, listOutstandingInvoices, markInvoiceHeld, markInvoicePaid } = await import("./store.js");

async function sentInvoice(dueInMs: number, hold = false) {
  const { sale } = createNewSale({ title: "Loop", deadlineMinutes: 60, invoiceMode: "sale_close", shipping: { tiers: [{ label: "Mailer", amountCents: 500 }] }, feePolicy: "split", feeRateBasisPoints: 349, feeFixedCents: 49, depositBasisPoints: 2000 });
  const item = addSaleItem(sale.id, { title: "Charizard", priceCents: 1250 });
  publish(sale.id);
  const [claim] = await submitClaims(sale.id, { handle: "buyer", email: "buyer@example.com", itemIds: [item.id], hold });
  expect(claim.hold).toBe(hold ? 1 : 0);
  return createInvoice({ sale_id: sale.id, buyer_handle: "buyer", buyer_email: "buyer@example.com", paypal_invoice_id: `INV2-${Math.random()}`, payer_url: null, status: "SENT", subtotal_cents: 1250, shipping_cents: 500, fee_cents: 110, total_cents: 1805, deposit_cents: null, due_at_ms: Date.now() + dueInMs }, [{ itemId: item.id, claimId: claim.id }]);
}

describe("reconciler reads every open invoice", () => {
  it("includes an invoice paid before its deadline, so PAID shows without waiting a day", async () => {
    const early = await sentInvoice(24 * 60 * 60 * 1000);
    expect(listOutstandingInvoices().map((invoice) => invoice.id)).toContain(early.id);
  });
  it("keeps a held invoice in the loop until it is paid in full", async () => {
    const held = await sentInvoice(-1000, true);
    expect(markInvoiceHeld(held)).toBe(true);
    expect(listOutstandingInvoices().map((invoice) => invoice.id)).toContain(held.id);
    expect(markInvoicePaid(getInvoice(held.id)!)).toBe(true);
    expect(getInvoice(held.id)!.status).toBe("PAID");
  });
});

describe("hold with deposit", () => {
  it("rounds the minimum deposit up to the cent", () => {
    expect(depositCents(1805, 2000)).toBe(361);
    expect(depositCents(1001, 2000)).toBe(201);
    expect(depositCents(1000, 10000)).toBe(1000);
    expect(() => depositCents(1000, 0)).toThrow();
    expect(() => depositCents(1000, 10001)).toThrow();
  });
  it("treats a partly paid invoice as held and never cancels it at the deadline", () => {
    expect(invoiceTransition("PARTIALLY_PAID", true, true)).toEqual({ status: "HELD", action: "hold" });
    expect(invoiceTransition("PARTIALLY_PAID", false, false)).toEqual({ status: "HELD", action: "hold" });
    expect(invoiceTransition("SENT", true, true).action).toBe("cancel_invoice");
  });
});

describe("tracking pushed to PayPal", () => {
  it("carries the PayPal transaction id, tracking number and carrier", () => {
    expect(trackerPayload("0FL39582BL8172154", "usps", "9400100000000000000000")).toEqual({ transaction_id: "0FL39582BL8172154", tracking_number: "9400100000000000000000", status: "SHIPPED", carrier: "USPS", notify_buyer: true });
    expect(trackerPayload("0FL39582BL8172154", "Pirate Ship", "ABC")).toMatchObject({ carrier: "OTHER", carrier_name_other: "Pirate Ship" });
  });
  it("refuses with a typed error when PayPal has no payment transaction", () => {
    expect(() => trackerPayload(undefined, "USPS", "940010")).toThrow(MissingTransactionError);
    expect(() => trackerPayload("", "USPS", "940010")).toThrow(MissingTransactionError);
  });
});

describe("G&S fee line on the PayPal invoice", () => {
  it("names who pays the fee", () => {
    expect(feeLineTitle("split")).toBe("G&S fee (split)");
    expect(feeLineTitle("buyer_pays")).toBe("G&S fee (buyer pays)");
  });
});
