// Groups the seller timeline so a backup rollover reads as one moment:
// an invoice_cancelled followed by the backup_promoted / item_reopened events it caused.
export type TimelineEntry<E> = { kind: "event"; event: E } | { kind: "rollover"; cancelled: E; promoted: E[]; reopened: E[]; reinvoiced: E | null };

export function groupRollovers<E extends { type: string; at_ms: number; payload: string }>(events: E[], windowMs = 5 * 60_000): TimelineEntry<E>[] {
  const sorted = [...events].sort((a, b) => a.at_ms - b.at_ms);
  const out: TimelineEntry<E>[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const event = sorted[i];
    if (event.type !== "invoice_cancelled") { out.push({ kind: "event", event }); continue; }
    const promoted: E[] = []; const reopened: E[] = []; let reinvoiced: E | null = null;
    let j = i + 1;
    for (; j < sorted.length && sorted[j].at_ms - event.at_ms <= windowMs; j++) {
      const next = sorted[j];
      if (next.type === "backup_promoted") promoted.push(next);
      else if (next.type === "item_reopened") reopened.push(next);
      else if (!reinvoiced && promoted.length && (next.type === "invoice_sent" || next.type === "invoice_started")) reinvoiced = next;
      else break;
    }
    out.push({ kind: "rollover", cancelled: event, promoted, reopened, reinvoiced });
    i = j - 1;
  }
  return out;
}
