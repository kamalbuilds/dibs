import { describe, expect, it } from "vitest";
import { aggregateComps, medianCents } from "./comps.js";

const offer = (price: number, currency = "USD", domain = "shop.example") => ({ url: `https://${domain}/p/${price}`, domain, price: { price, currency }, availability: "InStock", condition: "used" });
const product = (title: string, ...offers: ReturnType<typeof offer>[]) => ({ title, offers });

describe("price comps from Channel3 results", () => {
  it("takes the median in integer cents, averaging the middle pair", () => {
    expect(medianCents([1000, 3000, 2000])).toBe(2000);
    expect(medianCents([1000, 2000, 2001, 4000])).toBe(2001);
    const comps = aggregateComps("Sherlock Holmes", [product("Sherlock Holmes cigarette card", offer(12.5), offer(19.99), offer(15))]);
    expect(comps).toMatchObject({ count: 3, lowCents: 1250, medianCents: 1500, highCents: 1999 });
  });

  it("drops outliers outside the Tukey fences before taking the median", () => {
    const comps = aggregateComps("Irene Adler", [product("Irene Adler card", offer(20), offer(22), offer(24), offer(26), offer(950))]);
    expect(comps).toMatchObject({ count: 4, lowCents: 2000, medianCents: 2300, highCents: 2600 });
  });

  it("ignores offers in other currencies and listings for unrelated products", () => {
    const comps = aggregateComps("Professor Moriarty", [
      product("Professor Moriarty trading card", offer(30), offer(28, "GBP"), offer(32, "EUR")),
      product("Blue merino sweater", offer(5)),
    ]);
    expect(comps).toMatchObject({ count: 1, lowCents: 3000, medianCents: 3000 });
    expect(comps!.sources.map((source) => source.url)).toEqual(["https://shop.example/p/30"]);
  });

  it("returns null when nothing usable comes back, so the UI says No comps instead of guessing", () => {
    expect(aggregateComps("Tonga", [])).toBeNull();
    expect(aggregateComps("Tonga", [product("Tonga card", offer(9, "EUR"))])).toBeNull();
    expect(aggregateComps("Tonga", [product("Garden hose")])).toBeNull();
  });

  it("keeps at most three source listings, cheapest first, with links", () => {
    const comps = aggregateComps("Lestrade", [product("Lestrade card", offer(18, "USD", "a.example"), offer(16, "USD", "b.example"), offer(17, "USD", "c.example"), offer(19, "USD", "d.example"))]);
    expect(comps!.sources.map((source) => [source.domain, source.priceCents])).toEqual([["b.example", 1600], ["c.example", 1700], ["a.example", 1800]]);
  });
});
