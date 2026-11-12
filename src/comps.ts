export type CompSource = { title: string; domain: string; url: string; priceCents: number; condition: string | null };
export type CompStats = { count: number; lowCents: number; medianCents: number; highCents: number; sources: CompSource[] };
export type Comps = ({ status: "ok" } & CompStats | { status: "none" } | { status: "error"; message: string }) & { query: string; checkedAtMs: number };

type C3Offer = { url?: string; domain?: string; price?: { price?: number; amount?: number; currency?: string }; condition?: string | null };
type C3Product = { title?: string; offers?: C3Offer[] };

const filler = new Set(["the", "and", "with", "for", "card", "cards", "miss", "mrs", "set"]);
const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2 && !filler.has(word)) ?? [];

export function medianCents(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Comps only count listings whose title names the item, priced in the sale currency, with Tukey fences once there are enough to judge spread.
export function aggregateComps(itemTitle: string, products: C3Product[], currency = "USD"): CompStats | null {
  const wanted = words(itemTitle);
  const need = Math.min(2, wanted.length);
  const listings: CompSource[] = [];
  for (const product of products) {
    const title = product.title ?? "";
    const have = new Set(words(title));
    if (!need || wanted.filter((word) => have.has(word)).length < need) continue;
    for (const offer of product.offers ?? []) {
      const amount = offer.price?.price ?? offer.price?.amount;
      if (offer.price?.currency !== currency || typeof amount !== "number" || !(amount > 0) || !offer.url) continue;
      listings.push({ title, domain: offer.domain ?? new URL(offer.url).hostname, url: offer.url, priceCents: Math.round(amount * 100), condition: offer.condition ?? null });
    }
  }
  if (!listings.length) return null;
  listings.sort((a, b) => a.priceCents - b.priceCents);
  let kept = listings;
  if (listings.length >= 4) {
    const q1 = medianCents(listings.slice(0, Math.ceil(listings.length / 2)).map((l) => l.priceCents));
    const q3 = medianCents(listings.slice(Math.floor(listings.length / 2)).map((l) => l.priceCents));
    const fence = 1.5 * (q3 - q1);
    kept = listings.filter((l) => l.priceCents >= q1 - fence && l.priceCents <= q3 + fence);
  }
  const prices = kept.map((l) => l.priceCents);
  return { count: kept.length, lowCents: prices[0], medianCents: medianCents(prices), highCents: prices[prices.length - 1], sources: kept.slice(0, 3) };
}

export const compsConfigured = () => !!process.env.CHANNEL3_API_KEY;

export async function fetchComps(itemTitle: string, setOrPlatform: string | null): Promise<Comps> {
  const query = [itemTitle, setOrPlatform].filter(Boolean).join(" ");
  const checkedAtMs = Date.now();
  try {
    const response = await fetch("https://api.trychannel3.com/v1/search", {
      method: "POST", signal: AbortSignal.timeout(20_000),
      headers: { "x-api-key": process.env.CHANNEL3_API_KEY ?? "", "content-type": "application/json" },
      body: JSON.stringify({ query, limit: 20 }),
    });
    const body = await response.json().catch(() => null) as { products?: C3Product[]; detail?: unknown; message?: string } | null;
    if (!response.ok) return { status: "error", message: `Channel3 returned ${response.status}`, query, checkedAtMs };
    const stats = aggregateComps(itemTitle, body?.products ?? []);
    return stats ? { status: "ok", ...stats, query, checkedAtMs } : { status: "none", query, checkedAtMs };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Channel3 request failed", query, checkedAtMs };
  }
}
