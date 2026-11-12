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

const { archive } = await import("./service.js");
const { listSalesToClose } = await import("./store.js");
const { SaleInputSchema } = await import("./ai-schemas.js");
const rules = { invoiceMode: "first_claim" as const, shipping: { tiers: [{ label: "Mailer", amountCents: 500 }] }, feePolicy: "seller_absorbs" as const, feeRateBasisPoints: 349, feeFixedCents: 49, depositBasisPoints: 2000 };

describe("archived sales", () => {
  it("leave the public binder and refuse new claims", async () => {
    const { sale } = createNewSale({ title: "Leftover", deadlineMinutes: 60, ...rules, invoiceMode: "sale_close" });
    const item = addSaleItem(sale.id, { title: "Charizard", priceCents: 1250 });
    publish(sale.id);
    expect(publicSale(sale.slug)).not.toBeNull();
    archive(sale.id);
    expect(publicSale(sale.slug)).toBeNull();
    await expect(submitClaims(sale.id, { handle: "late", email: "late@example.com", itemIds: [item.id] })).rejects.toThrow(/closed/);
  });
});

describe("long-running sales", () => {
  it("accept a six-week claim window and nothing longer", () => {
    const input = { title: "Judge binder", deadlineMinutes: 60480, invoiceMode: "first_claim", shippingTiers: [{ label: "PWE", amountCents: 100 }] };
    expect(SaleInputSchema.safeParse(input).success).toBe(true);
    expect(SaleInputSchema.safeParse({ ...input, deadlineMinutes: 60481 }).success).toBe(false);
  });

  it("stay open for the reconciler until the deadline passes", () => {
    const { sale } = createNewSale({ title: "Long", deadlineMinutes: 60480, ...rules });
    addSaleItem(sale.id, { title: "Watson", priceCents: 2800 });
    publish(sale.id);
    expect(listSalesToClose(Date.now() + 41 * 86_400_000).map((row) => row.id)).not.toContain(sale.id);
    expect(listSalesToClose(sale.closes_at_ms).map((row) => row.id)).toContain(sale.id);
  });
});

const { refreshComps, itemComps } = await import("./service.js");
const { getItem } = await import("./store.js");

describe("comps without a Channel3 key", () => {
  it("report unavailable on both the review grid and the docket instead of nothing", async () => {
    const saved = process.env.CHANNEL3_API_KEY;
    delete process.env.CHANNEL3_API_KEY;
    try {
      const { sale } = createNewSale({ title: "No key", deadlineMinutes: 60, ...rules });
      const item = addSaleItem(sale.id, { title: "Pikachu Jungle", priceCents: 900 });
      const fresh = (await refreshComps([item.id])).get(item.id);
      expect(fresh).toMatchObject({ status: "error", query: "Pikachu Jungle" });
      expect(itemComps(getItem(item.id)!)).toMatchObject({ status: "error", query: "Pikachu Jungle" });
    } finally { if (saved !== undefined) process.env.CHANNEL3_API_KEY = saved; }
  });
});
