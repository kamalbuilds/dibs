import { describe, expect, it } from "vitest";
import { calculateCart, calculateFees, invoiceTransition, orderClaims, parseClaimCommand, resolveClaims, resolveItemRef, selectShipping } from "./domain.js";

describe("claim ordering and deduplication", () => {
  const claims = [
    { handle: "@first", email: "first@example.com", itemId: "a", atMs: 100, sequence: 2 },
    { handle: "@FIRST", email: "first@example.com", itemId: "a", atMs: 100, sequence: 3 },
    { handle: "@backup", email: "backup@example.com", itemId: "a", atMs: 100, sequence: 4 },
    { handle: "@early", email: "early@example.com", itemId: "a", atMs: 99, sequence: 5 },
  ];
  it("orders by server timestamp then paste sequence", () => {
    expect(orderClaims(claims).map((claim) => claim.handle)).toEqual(["@early", "@first", "@FIRST", "@backup"]);
  });
  it("keeps each handle once and promotes later claims to backups", () => {
    const result = resolveClaims(claims);
    expect(result?.winner.handle).toBe("@early");
    expect(result?.backups.map((claim) => claim.handle)).toEqual(["@first", "@backup"]);
    expect(result?.duplicateCount).toBe(1);
    expect(resolveClaims([])).toBeNull();
  });
});

describe("comment item references", () => {
  const items = [
    { id: "a", number: 3, title: "Charizard ex Special Illustration" },
    { id: "b", number: 7, title: "Charizard ex Promo" },
    { id: "c", number: 9, title: "Pikachu VMAX" },
  ];
  it.each(["3", "#3", "no. 3"])("resolves numeric reference %s", (ref) => {
    expect(resolveItemRef(ref, items)).toEqual({ status: "matched", itemId: "a" });
  });
  it("uses fuzzy titles and identifies ambiguity instead of guessing", () => {
    expect(resolveItemRef("Pikachu VMAX", items)).toEqual({ status: "matched", itemId: "c" });
    expect(resolveItemRef("Charizard ex", items).status).toBe("ambiguous");
  });
  it("flags unknown titles for seller review and rejects out of range numbers", () => {
    expect(resolveItemRef("blue eyes white dragon", items).status).toBe("needs_seller");
    expect(resolveItemRef(11, items)).toEqual({ status: "out_of_range" });
  });
});

describe("buyer quick claim commands", () => {
  const items = [{ id: "a", number: 3, title: "Charizard ex" }, { id: "b", number: 7, title: "Pikachu VMAX" }];
  it("resolves Mine, comma, hash, and and separators", () => {
    expect(parseClaimCommand("mine #3 and 7", items)).toEqual({ itemIds: ["a", "b"], unresolved: [] });
  });
  it("rejects invalid commands and flags out of range refs", () => {
    expect(parseClaimCommand("mine 3, 9", items)).toEqual({ itemIds: ["a"], unresolved: ["9"] });
    expect(parseClaimCommand("got 3", items).itemIds).toEqual([]);
  });
});

describe("shipping and fee math in integer cents", () => {
  const rules = { tiers: [{ label: "PWE", amountCents: 100, maxSubtotalCents: 5000, maxItems: 3 }, { label: "Tracked", amountCents: 500 }], freeOverCents: 15000 };
  it("chooses the matching tier and applies free shipping threshold", () => {
    expect(selectShipping(2500, 2, rules).label).toBe("PWE");
    expect(selectShipping(2500, 4, rules).label).toBe("Tracked");
    expect(selectShipping(15000, 9, rules)).toEqual({ label: "Free shipping", amountCents: 0 });
    expect(calculateCart(2500, 2, rules, "seller_absorbs", 349, 49).totalCents).toBe(2600);
  });
  it("rejects carts with no eligible tier and invalid money", () => {
    expect(() => selectShipping(10, 1, { tiers: [] })).toThrow("no shipping tier");
    expect(() => calculateFees(-1, "buyer_pays", 349, 49)).toThrow("non-negative");
  });
  it("rounds percentage to cents and splits odd fees deterministically", () => {
    expect(calculateFees(1001, "buyer_pays", 349, 49)).toEqual({ estimatedFeeCents: 84, buyerFeeCents: 84, sellerFeeCents: 0, buyerTotalCents: 1085 });
    expect(calculateFees(1001, "split", 0, 5).buyerFeeCents).toBe(3);
    expect(calculateFees(1001, "seller_absorbs", 0, 5).sellerFeeCents).toBe(5);
    expect(() => calculateFees(100, "unknown" as never, 349, 49)).toThrow();
  });
});

describe("invoice deadline transitions", () => {
  it("waits before deadline, marks payment, cancels before promoting a backup, and reopens without one", () => {
    expect(invoiceTransition("SENT", false, true).action).toBe("none");
    expect(invoiceTransition("PAID", true, true)).toEqual({ status: "PAID", action: "mark_paid" });
    expect(invoiceTransition("UNPAID", true, true).action).toBe("cancel_invoice");
    expect(invoiceTransition("CANCELLED", true, true).action).toBe("promote_backup");
    expect(invoiceTransition("CANCELLED", true, false)).toEqual({ status: "OPEN", action: "reopen" });
  });
  it("does not release unpaid but unexpired invoices", () => {
    expect(invoiceTransition("UNPAID", false, true)).toEqual({ status: "INVOICED", action: "none" });
  });
});
