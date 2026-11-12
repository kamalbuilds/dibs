import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "dibs-events-"));
const { createNewSale } = await import("./service.js");
const { addEvent, listEvents } = await import("./store.js");

it("shows one invoice_sent per invoice even when the row was written twice", () => {
  const { sale } = createNewSale({ title: "Dupes", deadlineMinutes: 60, invoiceMode: "first_claim", shipping: { tiers: [{ label: "Mailer", amountCents: 100 }] }, feePolicy: "split", feeRateBasisPoints: 349, feeFixedCents: 49, depositBasisPoints: 2000 });
  const payload = { invoiceId: "inv-1", paypalInvoiceId: "INV2-X", status: "SENT", totalCents: 2772 };
  addEvent(sale.id, "invoice_sent", payload);
  addEvent(sale.id, "invoice_sent", payload);
  addEvent(sale.id, "invoice_sent", { ...payload, invoiceId: "inv-2" });
  addEvent(sale.id, "invoice_reminder_sent", payload);
  addEvent(sale.id, "invoice_reminder_sent", payload);
  const sent = listEvents(sale.id).filter((event) => event.type === "invoice_sent");
  expect(sent.map((event) => JSON.parse(event.payload).invoiceId).sort()).toEqual(["inv-1", "inv-2"]);
  expect(listEvents(sale.id).filter((event) => event.type === "invoice_reminder_sent")).toHaveLength(2);
});
