import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Clock3, FileText, LoaderCircle, Mail, ShieldCheck, Undo2, X } from "lucide-react";
import { at, money } from "./format.ts";

type ClaimItem = { id: string; number: number; title: string; priceCents?: number | null; status?: string; backupCount?: number };
const pocket = (n: number | undefined) => `#${String(n).padStart(2, "0")}`;
const stampTime = (ms: number) => {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).formatToParts(d);
  return parts.map((part) => part.type === "second" ? `${part.value}.${String(d.getMilliseconds()).padStart(3, "0")}` : part.value).join("");
};

export type ClaimResult = {
  handle: string;
  email: string;
  receiptId: string;
  invoiceSent: boolean;
  replayed?: boolean;
  lines: Array<{ item: ClaimItem; kind: "claim" | "backup"; atMs: number; position: number }>;
};

/* The phone-first claim sheet: what you picked, what it costs, one thumb-sized button, and what happens after you press it. */
export function ClaimSheet({ items, handle, email, hold, busy, demoBuyer, depositPercent, onHandle, onEmail, onHold, onRemove, onClear, onSubmit }: {
  items: ClaimItem[]; handle: string; email: string; hold: boolean; busy: boolean; demoBuyer: string | null; depositPercent: number;
  onHandle: (value: string) => void; onEmail: (value: string) => void; onHold: (value: boolean) => void; onRemove: (id: string) => void; onClear: () => void; onSubmit: () => void;
}) {
  const subtotal = items.reduce((sum, item) => sum + (item.priceCents ?? 0), 0);
  const backups = items.filter((item) => item.status === "CLAIMED");
  const label = backups.length === items.length ? `Back me up on ${items.map((item) => pocket(item.number)).join(", ")}` : `Call dibs on ${items.map((item) => pocket(item.number)).join(", ")}`;
  return <form className="claim-sheet" aria-label="Your claim" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <div className="claim-sheet-head">
      <div className="claim-sheet-picked">
        <span className="eyebrow">YOUR CLAIM · {items.length} POCKET{items.length === 1 ? "" : "S"}</span>
        <ul>{items.map((item) => <li key={item.id}><span>{pocket(item.number)}</span>{item.status === "CLAIMED" && <em>backup</em>}<button type="button" aria-label={`Remove ${pocket(item.number)} from claim`} onClick={() => onRemove(item.id)}><X size={11} aria-hidden="true"/></button></li>)}</ul>
      </div>
      <div className="claim-sheet-total"><b className="numeric">{money(subtotal)}</b><small>+ shipping on one PayPal invoice</small></div>
      <button type="button" className="claim-sheet-clear" onClick={onClear}>Clear</button>
    </div>
    <div className="claim-sheet-fields">
      <label className="field"><span className="field-label">Social handle</span><input required maxLength={80} autoComplete="username" value={handle} onChange={(e) => onHandle(e.target.value.replace(/^@/, ""))} placeholder="@yourhandle"/></label>
      <label className="field"><span className="field-label">Email for the PayPal invoice</span><input required type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => onEmail(e.target.value)} placeholder="you@example.com"/></label>
    </div>
    <div className="claim-sheet-extras">
      {demoBuyer && <button type="button" className="sandbox-chip" onClick={() => onEmail(demoBuyer)} title={demoBuyer}><Mail size={12} aria-hidden="true"/>Use the PayPal sandbox buyer</button>}
      <label className="hold-toggle"><input type="checkbox" checked={hold} onChange={(e) => onHold(e.target.checked)}/>Hold with a {depositPercent}% deposit</label>
    </div>
    <button className="button button-primary claim-cta" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : null}{label}<ArrowRight size={16} aria-hidden="true"/></button>
    <ol className="claim-next" aria-label="What happens next">
      <li><Clock3 size={12} aria-hidden="true"/>Server stamps your claim to the millisecond</li>
      <li><FileText size={12} aria-hidden="true"/>PayPal emails one Goods &amp; Services invoice</li>
      <li><Undo2 size={12} aria-hidden="true"/>Unpaid at the deadline? It rolls to the next backup</li>
    </ol>
  </form>;
}

/* The claim moment: a stamped confirmation that says who won what, to the millisecond, and exactly what PayPal does next. */
export function ClaimConfirmation({ result, onDismiss }: { result: ClaimResult; onDismiss: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); ref.current?.focus({ preventScroll: true }); }, [result]);
  const won = result.lines.filter((line) => line.kind === "claim");
  const backed = result.lines.filter((line) => line.kind === "backup");
  const wonTotal = won.reduce((sum, line) => sum + (line.item.priceCents ?? 0), 0);
  const headline = won.length ? `Dibs on ${won.map((line) => pocket(line.item.number)).join(", ")}.` : `You're in line for ${backed.map((line) => pocket(line.item.number)).join(", ")}.`;
  return <section ref={ref} tabIndex={-1} className="claim-confirm" role="status" aria-live="polite">
    <button type="button" className="claim-confirm-close icon-button" aria-label="Close confirmation" onClick={onDismiss}><X size={16}/></button>
    <header className="claim-confirm-head"><div><p className="eyebrow">{result.replayed ? "ALREADY YOURS" : "CLAIM RECEIVED"} · {at(result.handle)}</p><h2>{result.replayed ? `Already yours: ${headline.charAt(0).toLowerCase()}${headline.slice(1)}` : headline}</h2></div><div className="claim-confirm-stamp" aria-hidden="true"><span>DIBS</span><small>{result.replayed ? "ON FILE" : won.length ? "CALLED" : "BACKUP"}</small></div></header>
    {result.replayed && <p className="claim-confirm-replay">Same handle, same email, same pockets: this is your original claim at its original server time. No new PayPal invoice was created.</p>}
    <ul className="claim-confirm-lines">{result.lines.map((line) => <li key={line.item.id} className={line.kind === "claim" ? "is-won" : "is-backup"}>
      <span className="claim-confirm-no">{pocket(line.item.number)}</span>
      <span className="claim-confirm-title">{line.item.title}</span>
      <span className="claim-confirm-pos">{line.kind === "claim" ? <><Check size={12} aria-hidden="true"/>First</> : <>Backup {line.position}</>}</span>
      <code className="claim-confirm-time" title="Server timestamp">{stampTime(line.atMs)}</code>
    </li>)}</ul>
    <ol className="claim-confirm-steps">
      <li className="done"><span><Check size={12} aria-hidden="true"/></span><div><strong>Timestamped</strong><small>The server clock decides order, not who refreshes fastest.</small></div></li>
      <li className={result.invoiceSent ? "done" : "next"}><span>{result.invoiceSent ? <Check size={12} aria-hidden="true"/> : "2"}</span><div><strong>{won.length ? `PayPal invoice${wonTotal ? `, ${money(wonTotal)} + shipping` : ""}` : "If the winner passes"}</strong><small>{won.length ? <>One Goods &amp; Services invoice to <b>{result.email}</b>{result.invoiceSent ? ", sent now." : " when the seller closes the sale."}</> : "Their item rolls to you automatically and PayPal invoices you."}</small></div></li>
      <li><span>3</span><div><strong>Pay with buyer protection</strong><small>Pay in PayPal; tracking is pushed back to the same invoice.</small></div></li>
    </ol>
    <div className="claim-confirm-actions">{result.receiptId && <Link className="button button-primary" to={`/receipt/${result.receiptId}`}>View receipt<ArrowRight size={15} aria-hidden="true"/></Link>}<button type="button" className="button button-secondary" onClick={onDismiss}>Keep browsing</button><span className="claim-confirm-note"><ShieldCheck size={13} aria-hidden="true"/>PayPal Goods &amp; Services</span></div>
  </section>;
}

export type LiveNote = { id: string; type: string; itemId: string | null; handle: string | null; atMs: number };

/* Live ticker on the buyer page: rollovers, fresh claims and payments arrive over SSE and read as a one-line moment. */
export function LiveTicker({ notes, items }: { notes: LiveNote[]; items: ClaimItem[] }) {
  if (!notes.length) return null;
  const text = (note: LiveNote) => {
    const item = items.find((row) => row.id === note.itemId);
    const no = item ? pocket(item.number) : "a pocket";
    const who = note.handle ? at(note.handle) : "The next backup";
    switch (note.type) {
      case "backup_promoted": return { tag: "ROLLOVER", line: <>{no} passed to the backup line. <b>{who}</b> moved up and gets the PayPal invoice.</> };
      case "item_reopened": return { tag: "REOPENED", line: <>{no} is open again. No one was left in the backup line.</> };
      case "invoice_paid": return { tag: "PAID", line: <>An invoice was paid through PayPal.</> };
      default: return { tag: "CLAIM", line: <><b>{who}</b> called dibs on {no}.</> };
    }
  };
  return <div className="live-ticker" role="log" aria-live="polite">{notes.map((note) => { const { tag, line } = text(note); return <p key={note.id} className={`live-note live-note-${note.type}`}><span>{tag}</span><em>{line}</em></p>; })}</div>;
}
