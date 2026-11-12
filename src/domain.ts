export type FeePolicy = "seller_absorbs" | "split" | "buyer_pays";

export interface ShippingTier {
  label: string;
  amountCents: number;
  maxSubtotalCents?: number;
  maxItems?: number;
}

export interface ShippingRules {
  tiers: ShippingTier[];
  freeOverCents?: number;
}

export interface ClaimInput {
  handle: string;
  email: string;
  itemId: string;
  atMs: number;
  sequence: number;
}

export interface ClaimResolution<T extends ClaimInput = ClaimInput> {
  winner: T;
  backups: T[];
  duplicateCount: number;
}

export interface FeeBreakdown {
  estimatedFeeCents: number;
  buyerFeeCents: number;
  sellerFeeCents: number;
  buyerTotalCents: number;
}

export interface CartTotals extends FeeBreakdown {
  subtotalCents: number;
  shippingCents: number;
  shippingLabel: string;
  totalCents: number;
}

export type InvoiceStatus = "SENT" | "UNPAID" | "PARTIALLY_PAID" | "PAID" | "MARKED_AS_PAID" | "CANCELLED" | "FAILED";

export function orderClaims<T extends Pick<ClaimInput, "atMs" | "sequence">>(claims: T[]): T[] {
  return [...claims].sort((a, b) => a.atMs - b.atMs || a.sequence - b.sequence);
}

export function resolveClaims<T extends ClaimInput>(claims: T[]): ClaimResolution<T> | null {
  const ordered = orderClaims(claims);
  if (!ordered.length) return null;

  const firstByHandle = new Map<string, T>();
  let duplicateCount = 0;
  for (const claim of ordered) {
    const key = claim.handle.trim().toLocaleLowerCase("en-US");
    if (firstByHandle.has(key)) duplicateCount++;
    else firstByHandle.set(key, claim);
  }
  const unique = orderClaims([...firstByHandle.values()]);
  return { winner: unique[0], backups: unique.slice(1), duplicateCount };
}

export function normalizeRef(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/^(?:#|no\.?\s*)/i, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function similarity(a: string, b: string): number {
  const aa = normalizeRef(a);
  const bb = normalizeRef(b);
  if (aa === bb) return 1;
  if (!aa || !bb) return 0;
  const at = new Set(aa.split(" "));
  const bt = new Set(bb.split(" "));
  const intersection = [...at].filter((token) => bt.has(token)).length;
  const dice = (2 * intersection) / (at.size + bt.size);
  const queryCoverage = intersection / Math.min(at.size, bt.size);
  const matrix = Array.from({ length: aa.length + 1 }, (_, i) => Array.from({ length: bb.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= aa.length; i++) {
    for (let j = 1; j <= bb.length; j++) {
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + (aa[i - 1] === bb[j - 1] ? 0 : 1));
    }
  }
  const edit = 1 - matrix[aa.length][bb.length] / Math.max(aa.length, bb.length);
  return Math.max(dice, edit, queryCoverage);
}

// The handle is the buyer in a claim sale; the email only says where PayPal sends the invoice.
export function groupByBuyer<T extends { handle: string; email: string }>(claims: T[]): Array<{ handle: string; email: string; claims: T[] }> {
  const groups = new Map<string, { handle: string; email: string; claims: T[] }>();
  for (const claim of claims) {
    const key = `${claim.handle.toLowerCase()}\n${claim.email.toLowerCase()}`;
    const group = groups.get(key) ?? { handle: claim.handle, email: claim.email, claims: [] };
    group.claims.push(claim);
    groups.set(key, group);
  }
  return [...groups.values()];
}

type ModelThreadEvent ={ handle: string; line: number; kind: "claim" | "backup" | "question" | "other"; itemRefs: Array<string | number>; timestamp: string | null };

// Raw text comes from the paste itself, so every event is provably linked to a real source line.
export function linkThreadEvents(lines: string[], events: ModelThreadEvent[]): Array<Omit<ModelThreadEvent, "handle"> & { handle: string; raw: string }> {
  let previous = 0;
  return events.map((event) => {
    if (!Number.isInteger(event.line) || event.line < 1 || event.line > lines.length) throw new Error(`line ${event.line} is outside the pasted thread`);
    if (event.line < previous) throw new Error(`line ${event.line} breaks source order`);
    previous = event.line;
    const handle = event.handle.trim();
    const bare = handle.replace(/^@/, "").toLowerCase();
    const above = lines.slice(Math.max(0, event.line - 8), event.line).join("\n").toLowerCase();
    if (!bare || !above.includes(bare)) throw new Error(`handle ${handle || "(empty)"} is not visible above line ${event.line}`);
    return { ...event, handle, raw: lines[event.line - 1] };
  });
}

const words = (value: string) => new Set(normalizeRef(value).split(" ").filter((word) => word.length >= 3));

// A title with no word in the label text the model read is a guess: push it under the 0.7 review flag.
export function groundVisionItem<T extends { title: string; read_text: string; confidence: number }>(item: T): T {
  const read = words(item.read_text);
  return [...words(item.title)].some((word) => read.has(word)) ? item : { ...item, confidence: Math.min(item.confidence, 0.5) };
}

export type RefResolution ={ status: "matched"; itemId: string } | { status: "ambiguous" | "needs_seller"; candidates: string[] } | { status: "out_of_range" };

export function resolveItemRef(ref: string | number, items: Array<{ id: string; number: number; title: string }>, threshold = 0.72): RefResolution {
  const text = String(ref).trim();
  const numberMatch = text.match(/^(?:#|no\.?\s*)?(\d+)$/i);
  if (numberMatch) {
    const item = items.find((candidate) => candidate.number === Number(numberMatch[1]));
    return item ? { status: "matched", itemId: item.id } : { status: "out_of_range" };
  }
  const scored = items.map((item) => ({ item, score: similarity(text, item.title) })).filter((entry) => entry.score >= threshold).sort((a, b) => b.score - a.score);
  if (!scored.length) return { status: "needs_seller", candidates: [] };
  if (scored.length > 1 && scored[0].score - scored[1].score < 0.08) return { status: "ambiguous", candidates: scored.slice(0, 3).map((entry) => entry.item.id) };
  return { status: "matched", itemId: scored[0].item.id };
}

export function parseClaimCommand(text: string, items: Array<{ id: string; number: number; title: string }>): { itemIds: string[]; unresolved: string[] } {
  const command = text.trim().match(/^(?:mine|claim)\s+(.+)$/i);
  if (!command) return { itemIds: [], unresolved: ["Use Mine followed by item numbers"] };
  const refs = command[1].replace(/\s+(?:and|&)\s+/gi, ",").split(/[;,]+/).map((part) => part.trim()).filter(Boolean);
  const itemIds: string[] = [];
  const unresolved: string[] = [];
  for (const ref of refs) {
    const match = ref.match(/^#?(\d+)$/);
    if (!match) { unresolved.push(ref); continue; }
    const result = resolveItemRef(Number(match[1]), items);
    if (result.status === "matched") {
      if (!itemIds.includes(result.itemId)) itemIds.push(result.itemId);
    } else unresolved.push(ref);
  }
  return { itemIds, unresolved };
}

export function selectShipping(subtotalCents: number, itemCount: number, rules: ShippingRules): ShippingTier {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0 || !Number.isInteger(itemCount) || itemCount < 1) throw new Error("invalid cart totals");
  if (rules.freeOverCents !== undefined && subtotalCents >= rules.freeOverCents) return { label: "Free shipping", amountCents: 0 };
  const tier = rules.tiers.find((entry) => (entry.maxSubtotalCents === undefined || subtotalCents <= entry.maxSubtotalCents) && (entry.maxItems === undefined || itemCount <= entry.maxItems));
  if (!tier) throw new Error("no shipping tier covers this order");
  return tier;
}

export function calculateFees(amountBeforeFeeCents: number, policy: FeePolicy, rateBasisPoints: number, fixedFeeCents: number): FeeBreakdown {
  if (!(["seller_absorbs", "split", "buyer_pays"] as string[]).includes(policy)) throw new Error("invalid fee policy");
  if (![amountBeforeFeeCents, rateBasisPoints, fixedFeeCents].every(Number.isInteger) || amountBeforeFeeCents < 0 || rateBasisPoints < 0 || fixedFeeCents < 0) throw new Error("fee inputs must be non-negative integer amounts");
  const estimatedFeeCents = Math.round((amountBeforeFeeCents * rateBasisPoints) / 10_000) + fixedFeeCents;
  const buyerFeeCents = policy === "buyer_pays" ? estimatedFeeCents : policy === "split" ? Math.ceil(estimatedFeeCents / 2) : 0;
  const sellerFeeCents = estimatedFeeCents - buyerFeeCents;
  return { estimatedFeeCents, buyerFeeCents, sellerFeeCents, buyerTotalCents: amountBeforeFeeCents + buyerFeeCents };
}

export function calculateCart(subtotalCents: number, itemCount: number, rules: ShippingRules, policy: FeePolicy, rateBasisPoints: number, fixedFeeCents: number): CartTotals {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) throw new Error("subtotal must be non-negative integer cents");
  const shipping = selectShipping(subtotalCents, itemCount, rules);
  const fee = calculateFees(subtotalCents + shipping.amountCents, policy, rateBasisPoints, fixedFeeCents);
  return { ...fee, subtotalCents, shippingCents: shipping.amountCents, shippingLabel: shipping.label, totalCents: fee.buyerTotalCents };
}

export type Transition = { status: "PAID" | "HELD" | "CANCELLED" | "OPEN" | "INVOICED"; action: "mark_paid" | "hold" | "cancel_invoice" | "promote_backup" | "reopen" | "none" };

export function invoiceTransition(invoiceStatus: InvoiceStatus, expired: boolean, backupAvailable: boolean): Transition {
  if (invoiceStatus === "PAID" || invoiceStatus === "MARKED_AS_PAID") return { status: "PAID", action: "mark_paid" };
  // A paid deposit holds the item past the claim deadline; only full payment moves it on.
  if (invoiceStatus === "PARTIALLY_PAID") return { status: "HELD", action: "hold" };
  if (invoiceStatus === "CANCELLED" && expired) return backupAvailable ? { status: "INVOICED", action: "promote_backup" } : { status: "OPEN", action: "reopen" };
  if ((invoiceStatus === "SENT" || invoiceStatus === "UNPAID") && expired) return { status: "INVOICED", action: "cancel_invoice" };
  return { status: "INVOICED", action: "none" };
}

export function depositCents(totalCents: number, depositBasisPoints: number): number {
  if (!Number.isInteger(totalCents) || totalCents <= 0) throw new Error("deposit needs a positive integer total");
  if (!Number.isInteger(depositBasisPoints) || depositBasisPoints < 1 || depositBasisPoints > 10000) throw new Error("deposit must be between 0.01% and 100%");
  return Math.ceil((totalCents * depositBasisPoints) / 10000);
}

export function feeLineTitle(policy: FeePolicy): string {
  return policy === "split" ? "G&S fee (split)" : "G&S fee (buyer pays)";
}
