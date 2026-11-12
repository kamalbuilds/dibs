import { describe, expect, it } from "vitest";
import { ClaimInputSchema, ItemInputSchema, SaleInputSchema, ThreadSchema, VisionSchema } from "./ai-schemas.js";

describe("AI response schemas", () => {
  it("accepts structured collectible detections and rejects unsupported confidence", () => {
    const item = { title: "Charizard ex", set_or_platform: "Pokémon TCG", condition_notes: null, position: 1, confidence: 0.8 };
    expect(VisionSchema.parse({ items: [item] }).items).toHaveLength(1);
    expect(VisionSchema.safeParse({ items: [{ ...item, confidence: 1.1 }] }).success).toBe(false);
    expect(VisionSchema.safeParse({ items: [{ ...item, title: "" }] }).success).toBe(false);
  });

  it("preserves typed comment events and rejects missing source lines", () => {
    const event = { handle: "@collector", raw: "@collector: mine 3", kind: "claim", itemRefs: [3], timestamp: "2m" };
    expect(ThreadSchema.parse({ events: [event] }).events[0].raw).toBe(event.raw);
    expect(ThreadSchema.safeParse({ events: [{ ...event, raw: "" }] }).success).toBe(false);
    expect(ThreadSchema.safeParse({ events: [{ ...event, kind: "invoice" }] }).success).toBe(false);
  });
});

describe("seller and buyer input boundaries", () => {
  const validSale = { title: "Saturday binder sale", deadlineMinutes: 5, invoiceMode: "sale_close", shippingTiers: [{ label: "PWE", amountCents: 100, maxItems: 3 }], feePolicy: "seller_absorbs" };
  it("accepts a minimum five-minute sale and rejects shorter deadlines", () => {
    expect(SaleInputSchema.safeParse(validSale).success).toBe(true);
    expect(SaleInputSchema.safeParse({ ...validSale, deadlineMinutes: 4 }).success).toBe(false);
  });
  it("requires a positive seller-confirmed item price and a valid buyer email", () => {
    expect(ItemInputSchema.safeParse({ title: "Charizard ex", priceCents: 6000 }).success).toBe(true);
    expect(ItemInputSchema.safeParse({ title: "Charizard ex", priceCents: 0 }).success).toBe(false);
    expect(ClaimInputSchema.safeParse({ handle: "@collector", email: "not-an-email", itemIds: ["id"] }).success).toBe(false);
  });
});
