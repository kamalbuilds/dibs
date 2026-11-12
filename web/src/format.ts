export const money = (cents: number | null | undefined) => cents == null ? "Set price" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export const dateTime = (ms: number) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(ms);
export const at = (handle: string) => handle.startsWith("@") ? handle : `@${handle}`;
const pocket = (n: number | undefined) => `#${String(n).padStart(2, "0")}`;

type TimelineEvent = { type: string; payload: string; item_id?: string | null };
type TimelineInvoice = { id: string; buyer_handle: string; total_cents: number; paypal_invoice_id?: string | null; payer_url: string | null };
type TimelineItem = { id: string; number: number };
export type PayPalRef = { id: string; href: string | null };
export type TimelinePart = string | PayPalRef;

// One readable sentence per sale event. PayPal invoice ids come back as their own part so the page can link them.
export function describeEvent(event: TimelineEvent, invoices: TimelineInvoice[], items: TimelineItem[]): TimelinePart[] {
  let p: Record<string, unknown> = {};
  try { p = event.payload ? JSON.parse(event.payload) as Record<string, unknown> : {}; } catch { /* unreadable payload falls through to the type name */ }
  const invoice = invoices.find((row) => row.id === p.invoiceId);
  const handle = typeof p.handle === "string" ? at(p.handle) : invoice ? at(invoice.buyer_handle) : "the buyer";
  const itemNumber = items.find((row) => row.id === event.item_id)?.number ?? (p.itemNumber ?? p.number) as number | undefined;
  const item = itemNumber != null ? pocket(itemNumber) : "an item";
  const paypalId = (p.paypalInvoiceId as string | null | undefined) ?? invoice?.paypal_invoice_id ?? null;
  const ref: TimelinePart = paypalId ? { id: paypalId, href: (p.payerUrl as string | undefined) ?? invoice?.payer_url ?? null } : "invoice";
  const total = money((p.totalCents as number | undefined) ?? invoice?.total_cents);
  switch (event.type) {
    case "sale_created": return [`Sale created: ${p.title}`];
    case "sale_published": return [`Published with ${p.itemCount} item${p.itemCount === 1 ? "" : "s"}, closes ${dateTime(p.closesAtMs as number)}`];
    case "sale_closed": return [p.reason === "claim_deadline" ? "Claim window closed" : "Sale closed by the seller"];
    case "sale_archived": return ["Sale archived; public link off"];
    case "deadline_extended": return [`Deadline moved to ${dateTime(p.toMs as number)}`];
    case "item_added": return [`${item} added: ${p.title}`];
    case "item_edited": return [`${item} edited${p.priceCents != null ? `, priced ${money(p.priceCents as number)}` : ""}`];
    case "item_removed": return [`${item} removed: ${p.title}`];
    case "item_photo_updated": return [`${item} photo ${p.source === "sale_photo" ? "cropped from the sale photo" : "replaced by the seller"}`];
    case "claim_received": return [`${handle} claimed ${item}${p.source === "import" ? " in the comments" : ""}`];
    case "backup_queued": return [`${handle} joined the backup line for ${item}`];
    case "comment_event_reviewed": return [`Comment from ${handle} imported as ${p.kind}`];
    case "invoice_started": return [`Drafting invoice for ${handle}${Array.isArray(p.items) ? `, ${p.items.map((n) => pocket(n as number)).join(", ")}` : ""}`];
    case "invoice_sent": return ["Invoice ", ref, ` sent to ${handle}, ${total}`];
    case "invoice_reminder_sent": return ["Reminder sent to ", handle, " for ", ref];
    case "deposit_held": return [`${handle} paid a ${money(p.depositCents as number)} deposit on `, ref];
    case "invoice_paid": return [`${handle} paid `, ref, `, ${total}`];
    case "invoice_cancelled": return ["Invoice ", ref, ` to ${handle} cancelled; item passes to the backup line`];
    case "backup_promoted": return [`${handle} moved up from backup on ${item}`];
    case "item_reopened": return [`${item} reopened; no one left in the backup line`];
    case "tracking_on_paypal": return [`${p.carrier} ${p.tracking} added to PayPal for ${handle}`];
    case "invoice_failed": case "invoice_retry_failed": return [`Invoice for ${handle} failed: ${p.message}`];
    case "reconcile_failed": return [`PayPal status check for ${handle} failed: ${p.message}`];
    default: return [event.type.replaceAll("_", " ")];
  }
}
