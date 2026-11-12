import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "dibs-service-"));
const { addSaleItem, createNewSale, publicSale, publish, submitClaims } = await import("./service.js");

describe("public backup count", () => {
  it("does not count the current claimant as a backup", async () => {
    const { sale } = createNewSale({ title: "Backup count", deadlineMinutes: 60, invoiceMode: "sale_close", shipping: { tiers: [{ label: "Mailer", amountCents: 500 }] }, feePolicy: "seller_absorbs", feeRateBasisPoints: 349, feeFixedCents: 49, depositBasisPoints: 2000 });
    const item = addSaleItem(sale.id, { title: "Charizard", priceCents: 1250 });
    publish(sale.id);
    const count = () => publicSale(sale.slug)!.items[0].backupCount;

    expect(count()).toBe(0);
    await submitClaims(sale.id, { handle: "first", email: "first@example.com", itemIds: [item.id] });
    expect(count()).toBe(0);
    await submitClaims(sale.id, { handle: "second", email: "second@example.com", itemIds: [item.id] });
    expect(count()).toBe(1);
  });
});
