// Which docket rows just became sold (paid on PayPal) between two renders, for the live flash and announcement.
export const SOLD_STATUSES = new Set(["PAID", "MARKED_AS_PAID"]);

export type SoldChange = { id: string; number: string; title: string; buyer: string };

export function soldTransitions(previous: Map<string, string> | null, rows: Array<{ id: string; status: string; number: string; title: string; buyer: string }>): SoldChange[] {
  if (!previous) return [];
  return rows.filter((row) => SOLD_STATUSES.has(row.status) && previous.has(row.id) && !SOLD_STATUSES.has(previous.get(row.id)!))
    .map((row) => ({ id: row.id, number: row.number, title: row.title, buyer: row.buyer }));
}

export const soldAnnouncement = (changes: SoldChange[]) => changes.map((change) => `${change.number} ${change.title} sold${change.buyer ? ` to ${change.buyer}` : ""}`).join(" · ");
