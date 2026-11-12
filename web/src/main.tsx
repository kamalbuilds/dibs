import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ColGroupDef, type ICellRendererParams } from "ag-grid-community";
import { ArrowDownToLine, ArrowUpRight, Check, ChevronRight, CircleHelp, Clock3, ImagePlus, LoaderCircle, Plus, Radio, Settings2, ShieldCheck, X } from "lucide-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import "./styles.css";

ModuleRegistry.registerModules([AllCommunityModule]);

type Item = { id: string; number: number; title: string; set_or_platform?: string | null; condition_notes?: string | null; setOrPlatform?: string | null; conditionNotes?: string | null; price_cents?: number | null; priceCents?: number | null; confidence?: number | null; status?: string; backupCount?: number; queue?: Array<{ handle: string; atMs: number; kind: string }> };
type Sale = { id: string; slug?: string; title: string; status?: string; closes_at_ms?: number; closesAtMs?: number; published_at_ms?: number | null; fee_policy?: string; fee_rate_bp?: number; fee_fixed_cents?: number; invoice_mode?: string; shipping_json?: string };
type Config = { missing: string[]; demoBuyerEmail: string | null; aiModel: string; paypalEnvironment: string };
type Invoice = { id: string; buyer_handle: string; buyer_email: string; status: string; subtotal_cents: number; shipping_cents: number; fee_cents: number; total_cents: number; due_at_ms: number; payer_url: string | null; items: Item[]; shipment?: { carrier: string; tracking: string } };
type EventRow = { id: string; type: string; at_ms: number; payload: string };
type Claim = { item_id: string; handle: string; email: string; at_ms: number; kind: string; sequence: number };
type ImportEvent = { handle: string; raw: string; kind: "claim" | "backup" | "question" | "other"; itemRefs: Array<string | number>; timestamp: string | null; pasteOrder: number; resolutions: Array<{ ref: string | number; status: string; itemId?: string; candidates?: string[] }>; needsSeller: boolean; atMs: number; email: string; itemIds: string[] };

const money = (cents: number | null | undefined) => cents == null ? "Set price" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const time = (ms: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(ms);
const dateTime = (ms: number) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(ms);
const keyName = (id: string) => `dibs-owner:${id}`;
const ownerKey = (id: string) => localStorage.getItem(keyName(id)) || "";
const eventTypes = ["claim_received", "backup_queued", "invoice_started", "invoice_sent", "invoice_failed", "invoice_reminder_sent", "invoice_paid", "invoice_cancelled", "backup_promoted", "item_reopened", "shipment_recorded", "sale_closed"];

async function api<T>(path: string, init: RequestInit = {}, key?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (key) headers.set("x-seller-key", key);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

function usePageTitle(title: string) { useEffect(() => { document.title = `Dibs: ${title}`; }, [title]); }

function SetupNotice() {
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => { api<Config>("/api/config").then(setConfig).catch(() => setConfig({ missing: ["API server"], demoBuyerEmail: null, aiModel: "", paypalEnvironment: "" })); }, []);
  if (!config?.missing.length) return null;
  return <aside className="setup-notice"><Settings2 size={16} aria-hidden="true"/><span><strong>Setup needed</strong> {config.missing.join(", ")}</span><Link to="/setup">Setup details <ChevronRight size={14}/></Link></aside>;
}

function Shell({ children, buyer = false }: { children: React.ReactNode; buyer?: boolean }) {
  return <><SetupNotice/><header className={`masthead ${buyer ? "buyer-masthead" : ""}`}><Link to="/" className="wordmark" aria-label="Dibs home">dibs<span>.</span></Link>{!buyer && <nav aria-label="Main navigation"><Link to="/">New sale</Link><Link to="/setup">Setup</Link></nav>}<span className="masthead-note">CLAIM SALES, SETTLED</span></header>{children}<footer className="site-footer"><span>DIBS / COLLECTOR SALES</span><Link to="/setup">Connection status</Link></footer></>;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) { return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>; }

function CreateSale() {
  usePageTitle("Start a sale");
  const navigate = useNavigate();
  const [sale, setSale] = useState<Sale | null>(null);
  const [key, setKey] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [title, setTitle] = useState("");
  const [deadlineMinutes, setDeadlineMinutes] = useState(1440);
  const [invoiceMode, setInvoiceMode] = useState("sale_close");
  const [shippingLabel, setShippingLabel] = useState("Tracked mailer");
  const [shippingAmount, setShippingAmount] = useState("5");
  const [pweAmount, setPweAmount] = useState("1");
  const [freeOver, setFreeOver] = useState("150");
  const [feePolicy, setFeePolicy] = useState("seller_absorbs");
  const [feeRate, setFeeRate] = useState("3.49");
  const [feeFixed, setFeeFixed] = useState("0.49");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manual, setManual] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualPrice, setManualPrice] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      // PayPal US commercial transaction defaults: https://www.paypal.com/us/business/paypal-business-fees
      const created = await api<{ sale: Sale; ownerKey: string }>("/api/sales", { method: "POST", body: JSON.stringify({ title, deadlineMinutes: Number(deadlineMinutes), invoiceMode, shippingTiers: [{ label: "PWE, under $50 and max 3 items", amountCents: Math.round(Number(pweAmount) * 100), maxSubtotalCents: 5000, maxItems: 3 }, { label: shippingLabel, amountCents: Math.round(Number(shippingAmount) * 100) }], freeOverCents: Math.round(Number(freeOver) * 100), feePolicy, feeRateBasisPoints: Math.round(Number(feeRate) * 100), feeFixedCents: Math.round(Number(feeFixed) * 100) }) });
      localStorage.setItem(keyName(created.sale.id), created.ownerKey); setKey(created.ownerKey); setSale(created.sale);
      if (files.length) await upload(created.sale.id, created.ownerKey, files);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create sale"); }
    finally { setBusy(false); }
  }

  async function upload(id: string, owner: string, photos: File[]) {
    setError(""); setBusy(true);
    try {
      const form = new FormData(); photos.forEach((file) => form.append("photos", file));
      const result = await api<{ items: Item[] }>(`/api/sales/${id}/vision`, { method: "POST", body: form }, owner);
      setItems((current) => [...current, ...result.items]); setFiles([]);
    } catch (err) { setError(err instanceof Error ? err.message : "Photo itemization failed"); }
    finally { setBusy(false); }
  }

  async function saveItem(item: Item) {
    try {
      const saved = await api<{ item: Item }>(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ title: item.title, setOrPlatform: item.set_or_platform ?? item.setOrPlatform ?? null, conditionNotes: item.condition_notes ?? item.conditionNotes ?? null, priceCents: Number(item.price_cents ?? item.priceCents) }) }, key);
      setItems((current) => current.map((row) => row.id === item.id ? saved.item : row));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save item"); }
  }

  async function addManual() {
    if (!sale || !manualTitle.trim() || Number(manualPrice) <= 0) return;
    try { const result = await api<{ item: Item }>(`/api/sales/${sale.id}/items`, { method: "POST", body: JSON.stringify({ title: manualTitle, priceCents: Math.round(Number(manualPrice) * 100) }) }, key); setItems((current) => [...current, result.item]); setManualTitle(""); setManualPrice(""); setManual(false); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not add item"); }
  }

  async function publish() {
    if (!sale) return;
    setBusy(true); setError("");
    try {
      for (const item of items) {
        if (!item.title.trim() || !Number(item.price_cents ?? item.priceCents)) throw new Error(`Add a title and price for item #${String(item.number).padStart(2, "0")}`);
        await api(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ title: item.title, setOrPlatform: item.set_or_platform ?? item.setOrPlatform ?? null, conditionNotes: item.condition_notes ?? item.conditionNotes ?? null, priceCents: Number(item.price_cents ?? item.priceCents) }) }, key);
      }
      const persisted = await api<{ items: Item[] }>(`/api/sales/${sale.id}`, {}, key);
      const incomplete = persisted.items.filter((item) => !item.price_cents);
      if (incomplete.length) throw new Error(`Set a price for ${incomplete.length} item${incomplete.length === 1 ? "" : "s"} before publishing`);
      const result = await api<{ url: string }>(`/api/sales/${sale.id}/publish`, { method: "POST" }, key);
      navigate(`/dash/${sale.id}`); history.replaceState(null, "", `/dash/${sale.id}`); void result;
    } catch (err) { setError(err instanceof Error ? err.message : "Could not publish sale"); }
    finally { setBusy(false); }
  }

  return <Shell><main className="page create-page"><div className="page-kicker"><span>SELLER / NEW SALE</span><span>01 / 03</span></div><div className="create-intro"><div><p className="eyebrow">THE BINDER STARTS HERE</p><h1>Put the good stuff<br/>on the table.</h1><p className="lede">Set your house rules, add the items, then send one link to your buyers.</p></div><div className="folio-mark" aria-hidden="true"><span>DS</span><small>SALE<br/>FOLIO</small></div></div>
    {!sale ? <form className="rules-form" onSubmit={create}><div className="section-head"><span className="step-number">01</span><div><h2>Sale rules</h2><p>These apply to every claim in this binder.</p></div></div><div className="form-grid"><Field label="Sale name"><input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sunday binder cleanout"/></Field><Field label="Claim window" hint="At least 5 minutes"><select value={deadlineMinutes} onChange={(e) => setDeadlineMinutes(Number(e.target.value))}><option value={5}>5 minutes</option><option value={60}>1 hour</option><option value={360}>6 hours</option><option value={1440}>24 hours</option><option value={2880}>48 hours</option></select></Field><Field label="Invoice timing"><select value={invoiceMode} onChange={(e) => setInvoiceMode(e.target.value)}><option value="sale_close">When I close the sale</option><option value="first_claim">After each first claim</option></select></Field><Field label="PWE shipping · under $50, max 3 items"><div className="input-prefix"><span>$</span><input type="number" min="0" step="0.01" required value={pweAmount} onChange={(e) => setPweAmount(e.target.value)}/></div></Field><Field label="Tracked shipping name"><input required value={shippingLabel} onChange={(e) => setShippingLabel(e.target.value)} placeholder="Tracked mailer"/></Field><Field label="Tracked shipping price"><div className="input-prefix"><span>$</span><input type="number" min="0" step="0.01" required value={shippingAmount} onChange={(e) => setShippingAmount(e.target.value)}/></div></Field><Field label="Free shipping over"><div className="input-prefix"><span>$</span><input type="number" min="1" step="0.01" required value={freeOver} onChange={(e) => setFreeOver(e.target.value)}/></div></Field><Field label="PayPal G&amp;S fee policy"><select value={feePolicy} onChange={(e) => setFeePolicy(e.target.value)}><option value="seller_absorbs">I cover the fee</option><option value="split">Split the fee</option><option value="buyer_pays">Buyer covers the fee</option></select></Field><Field label="Fee rate (%)"><input type="number" min="0" max="100" step="0.01" required value={feeRate} onChange={(e) => setFeeRate(e.target.value)}/></Field><Field label="Fixed fee"><div className="input-prefix"><span>$</span><input type="number" min="0" step="0.01" required value={feeFixed} onChange={(e) => setFeeFixed(e.target.value)}/></div></Field></div><p className="rules-note"><ShieldCheck size={15}/> Goods &amp; Services invoices include buyer protection. Defaults: 3.49% + $0.49, editable here.</p><div className="section-foot"><span>Rules can’t change after the first claim.</span><button className="button button-primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : null}Create sale <ChevronRight size={16}/></button></div></form> : <section className="item-workbench"><div className="section-head"><span className="step-number">02</span><div><h2>Itemize the table</h2><p>AI suggestions stay in draft until you set a price and publish.</p></div></div><div className="upload-row"><label className="upload-drop"><ImagePlus size={22}/><span>{files.length ? `${files.length} photo${files.length > 1 ? "s" : ""} selected` : "Choose up to 4 sale photos"}</span><small>JPG, PNG, or WebP. Keep item fronts visible.</small><input type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 4))}/></label><button className="button button-secondary" disabled={!files.length || busy} onClick={() => void upload(sale.id, key, files)}>{busy ? <LoaderCircle className="spin" size={16}/> : <ArrowDownToLine size={16}/>}Review photos</button><button className="button button-text" onClick={() => setManual((value) => !value)}><Plus size={16}/> Add item by hand</button></div>
      {manual && <div className="manual-add"><Field label="Item name"><input value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} placeholder="Card or item name"/></Field><Field label="Price"><div className="input-prefix"><span>$</span><input type="number" min="0.01" step="0.01" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)}/></div></Field><button className="button button-primary" onClick={() => void addManual()}>Add to binder</button></div>}
      {items.length ? <div className="review-grid"><div className="review-head"><span>POCKET</span><span>ITEM DETAILS</span><span>PRICE / USD</span><span>AI CONFIDENCE</span></div>{items.map((item) => <article className="review-row" key={item.id}><div className="review-pocket">#{String(item.number).padStart(2, "0")}</div><div className="review-detail"><input aria-label={`Item ${item.number} title`} value={item.title} onChange={(e) => setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, title: e.target.value } : row))}/><input aria-label={`Item ${item.number} set or platform`} value={item.set_or_platform ?? item.setOrPlatform ?? ""} placeholder="Set / platform" onChange={(e) => setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, set_or_platform: e.target.value } : row))}/><input aria-label={`Item ${item.number} condition notes`} value={item.condition_notes ?? item.conditionNotes ?? ""} placeholder="Condition notes" onChange={(e) => setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, condition_notes: e.target.value } : row))}/></div><div className="input-prefix price-entry"><span>$</span><input aria-label={`Item ${item.number} price`} type="number" min="0.01" step="0.01" value={((item.price_cents ?? item.priceCents ?? 0) / 100) || ""} placeholder="Required" onChange={(e) => setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, price_cents: Math.round(Number(e.target.value) * 100) || null } : row))}/><button className="icon-button" aria-label={`Save item ${item.number}`} title="Save item" onClick={() => void saveItem(item)}><Check size={15}/></button></div><span className={`confidence ${Number(item.confidence ?? 1) < 0.7 ? "confidence-low" : ""}`}>{item.confidence == null ? "Seller entered" : `${Math.round(item.confidence * 100)}% match`}{Number(item.confidence ?? 1) < 0.7 && <small>Review name</small>}</span></article>)}</div> : <div className="empty-paper"><ImagePlus size={22}/><strong>Ready for the first pocket</strong><span>Choose a sale photo above or add the first item yourself.</span><button className="button button-secondary" onClick={() => setManual(true)}>Add the first item</button></div>}
      <div className="publish-strip"><div><span className="field-label">YOUR PUBLIC LINK</span><code>/s/{sale.slug}</code></div><button className="button button-primary" disabled={!items.length || busy} onClick={() => void publish()}>{busy ? <LoaderCircle className="spin" size={16}/> : null}Publish sale <ArrowUpRight size={16}/></button></div>
    </section>}
    {error && <p className="error-message" role="alert">{error}</p>}</main></Shell>;
}

function Countdown({ due }: { due: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.floor((due - now) / 1000));
  return <span className={seconds < 3600 ? "deadline-soon numeric" : "numeric"}>{seconds ? `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m` : "Due now"}</span>;
}

function StatusCell({ value }: Pick<ICellRendererParams, "value">) {
  return <span className={`status status-${String(value ?? "open").toLowerCase()}`}><i aria-hidden="true"/>{value || "OPEN"}</span>;
}

function Dashboard() {
  usePageTitle("Seller dashboard");
  const { saleId = "" } = useParams();
  const [data, setData] = useState<{ sale: Sale; items: Item[]; claims: Claim[]; invoices: Invoice[]; events: EventRow[] } | null>(null);
  const [error, setError] = useState("");
  const [ship, setShip] = useState<Invoice | null>(null);
  const [quickFilter, setQuickFilter] = useState("");
  const [carrier, setCarrier] = useState(""); const [tracking, setTracking] = useState("");
  const [accessKey, setAccessKey] = useState(() => ownerKey(saleId));
  const load = useCallback(async () => { try { setData(await api(`/api/sales/${saleId}`, {}, accessKey)); setError(""); } catch (err) { setError(err instanceof Error ? err.message : "Could not load sale"); } }, [saleId, accessKey]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!saleId) return; const events = new EventSource(`/api/events?saleId=${encodeURIComponent(saleId)}`); eventTypes.forEach((type) => events.addEventListener(type, () => void load())); return () => events.close(); }, [saleId, load]);

  const totals = useMemo(() => (data?.invoices ?? []).reduce((sum, invoice) => ({ subtotal: sum.subtotal + invoice.subtotal_cents, shipping: sum.shipping + invoice.shipping_cents, fees: sum.fees + invoice.fee_cents, total: sum.total + invoice.total_cents }), { subtotal: 0, shipping: 0, fees: 0, total: 0 }), [data]);
  const rowData = useMemo(() => (data?.items ?? []).map((item) => {
    const itemClaims = (data?.claims ?? []).filter((claim) => claim.item_id === item.id);
    const invoice = (data?.invoices ?? []).find((record) => record.items.some((part) => part.id === item.id));
    const first = itemClaims[0];
    return { number: `#${String(item.number).padStart(2, "0")}`, photo: "", title: item.title, buyer: first?.handle ? `@${first.handle}` : "", claimed: first?.at_ms ? time(first.at_ms) : "", backup: Math.max(0, itemClaims.length - 1), subtotal: item.price_cents ?? 0, shipping: invoice?.shipping_cents ?? 0, fee: invoice?.fee_cents ?? 0, total: invoice?.total_cents ?? 0, status: item.status ?? "OPEN", due: invoice?.due_at_ms, invoice, item };
  }), [data]);

  async function invoiceAction(id: string, action: "remind" | "cancel" | "retry") {
    try { await api(`/api/invoices/${id}/${action}`, { method: "POST" }, accessKey); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Invoice action failed"); }
  }
  async function sendInvoices() {
    try { await api(`/api/sales/${saleId}/close`, { method: "POST" }, accessKey); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Could not send invoices"); }
  }
  async function saveShipment(e: React.FormEvent) {
    e.preventDefault(); if (!ship) return;
    try { await api(`/api/invoices/${ship.id}/ship`, { method: "POST", body: JSON.stringify({ carrier, tracking }) }, accessKey); setShip(null); setCarrier(""); setTracking(""); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Could not save tracking"); }
  }

  const columnDefs: Array<ColDef | ColGroupDef> = [
    { headerName: "Item", marryChildren: true, children: [{ field: "number", headerName: "#", width: 72, pinned: "left" }, { field: "photo", headerName: "Photo", width: 74, cellRenderer: () => <span className="photo-mark"><ImagePlus size={15}/></span> }, { field: "title", headerName: "Name", minWidth: 180, flex: 1 }] },
    { headerName: "Claim", marryChildren: true, children: [{ field: "buyer", headerName: "Buyer", width: 110 }, { field: "claimed", headerName: "Claimed at", width: 124, cellClass: "cell-mono" }, { field: "backup", headerName: "Backup", width: 90, cellClass: "numeric" }] },
    { headerName: "Invoice", marryChildren: true, children: [{ field: "status", headerName: "Status", width: 124, cellRenderer: StatusCell }, { field: "due", headerName: "Due", width: 110, valueFormatter: (p) => p.value ? "" : "", cellRenderer: (p: ICellRendererParams) => p.value ? <Countdown due={p.value}/> : "" }, { field: "subtotal", headerName: "Items", width: 98, valueFormatter: (p) => money(p.value), cellClass: "cell-money" }, { field: "shipping", headerName: "Ship", width: 90, valueFormatter: (p) => money(p.value), cellClass: "cell-money" }, { field: "fee", headerName: "Fee", width: 90, valueFormatter: (p) => money(p.value), cellClass: "cell-money" }, { field: "total", headerName: "Total", width: 100, valueFormatter: (p) => money(p.value), cellClass: "cell-money" }] },
    { field: "actions", headerName: "Actions", width: 220, sortable: false, filter: false, cellRenderer: (p: ICellRendererParams) => p.data.invoice ? <div className="row-actions"><button onClick={() => void invoiceAction(p.data.invoice.id, "remind")}>Remind</button>{p.data.status === "PAID" ? <button onClick={() => setShip(p.data.invoice)}>Ship</button> : <button onClick={() => void invoiceAction(p.data.invoice.id, "cancel")}>Pass</button>}</div> : "" },
  ];
  const pinnedBottomRowData = [{ number: "TOTALS", title: "Invoice totals", buyer: "", claimed: "", backup: "", status: "", due: "", subtotal: totals.subtotal, shipping: totals.shipping, fee: totals.fees, total: totals.total }];
  const buyers = new Set((data?.claims ?? []).map((claim) => claim.handle.toLowerCase())).size;

  if (error && !data) return <Shell><main className="page"><p className="eyebrow">SELLER / ACCESS</p><h1>Open your sale.</h1><p className="error-message">{error}</p><Field label="Seller access key"><input aria-label="Seller access key" type="password" autoComplete="current-password" value={accessKey} onChange={(e) => { setAccessKey(e.target.value); localStorage.setItem(keyName(saleId), e.target.value); }} /></Field><button className="button button-primary" onClick={() => void load()}>Continue</button></main></Shell>;
  if (!data) return <Shell><main className="page loading-state"><LoaderCircle className="spin"/>Opening sale docket…</main></Shell>;
  return <Shell><main className="page dashboard-page"><div className="page-kicker"><span>SELLER / LIVE DOCKET</span><span>{data.sale.status === "CLOSED" ? "CLOSED" : "OPEN FOR CLAIMS"}</span></div><div className="dashboard-heading"><div><p className="eyebrow">SALE / {data.sale.id.slice(0, 8).toUpperCase()}</p><h1>{data.sale.title}</h1><p className="lede">Public binder <Link to={`/s/${data.sale.slug}`} target="_blank">/s/{data.sale.slug} <ArrowUpRight size={13}/></Link><span className="divider">·</span> Closes {dateTime(data.sale.closes_at_ms ?? Date.now())}</p></div><div className="dashboard-actions"><Link className="button button-secondary" to={`/import/${saleId}`}><ArrowDownToLine size={15}/>Import comments</Link><button className="button button-primary" disabled={data.sale.status === "CLOSED" || !buyers} onClick={() => void sendInvoices()}>Send PayPal invoices ({buyers} buyer{buyers === 1 ? "" : "s"})</button></div></div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="grid-toolbar"><div><span className="live-dot"/> LIVE CLAIM REGISTER <span className="grid-count">{data.items.length} pockets / {data.claims.length} claim events</span></div><label className="quick-filter">Filter rows <input aria-label="Filter sale rows" placeholder="Name, buyer, status…" value={quickFilter} onChange={(e) => setQuickFilter(e.target.value)}/></label></div>
      <div className="grid-wrap"><AgGridReact theme={themeQuartz.withParams({ backgroundColor: "#fffefa", foregroundColor: "#111111", headerBackgroundColor: "#eeeae1", borderColor: "#d8d2c7", rowHoverColor: "#f5f1e9", fontFamily: "'Onest', sans-serif", fontSize: 13, rowHeight: 40, headerHeight: 40, spacing: 8 })} rowData={rowData} columnDefs={columnDefs} defaultColDef={{ sortable: true, resizable: true, filter: true, suppressHeaderMenuButton: true }} quickFilterText={quickFilter} pinnedBottomRowData={pinnedBottomRowData} animateRows={false} /></div>
      <section className="seller-lower"><div className="paper-section"><div className="section-title"><h2>Sale timeline</h2><span>{data.events.length} events</span></div>{data.events.length ? <ol className="timeline">{[...data.events].reverse().slice(0, 12).map((event) => <li key={event.id}><span className="timeline-mark"><Clock3 size={13}/></span><span><strong>{event.type.replaceAll("_", " ")}</strong><small>{dateTime(event.at_ms)}</small></span><code>{event.payload ? JSON.stringify(JSON.parse(event.payload)) : ""}</code></li>)}</ol> : <div className="empty-compact">No activity recorded yet.</div>}</div><div className="paper-section invoice-list"><div className="section-title"><h2>Invoices</h2><span>{data.invoices.length} sent</span></div>{data.invoices.length ? data.invoices.map((invoice) => <article className="invoice-line" key={invoice.id}><div><strong>@{invoice.buyer_handle}</strong><small>{invoice.items.length} item{invoice.items.length === 1 ? "" : "s"} · due {dateTime(invoice.due_at_ms)}</small></div><StatusCell value={invoice.status}/><b className="numeric">{money(invoice.total_cents)}</b>{invoice.payer_url && <a href={invoice.payer_url} target="_blank" rel="noreferrer" aria-label={`Open invoice for ${invoice.buyer_handle}`}><ArrowUpRight size={15}/></a>}</article>) : <div className="empty-compact">Invoices appear here after you close the sale.</div>}</div></section>
    </main>{ship && <div className="dialog-backdrop" role="presentation"><form className="dialog" aria-labelledby="ship-title" onSubmit={saveShipment}><button type="button" className="dialog-close icon-button" aria-label="Close tracking form" onClick={() => setShip(null)}><X size={18}/></button><p className="eyebrow">FULFILLMENT / @{ship.buyer_handle}</p><h2 id="ship-title">Add tracking</h2><Field label="Carrier"><input required value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="USPS"/></Field><Field label="Tracking number"><input required value={tracking} onChange={(e) => setTracking(e.target.value)} /></Field><button className="button button-primary">Save shipment</button></form></div>}</Shell>;
}

function SalePage() {
  usePageTitle("Live sale");
  const { slug = "" } = useParams();
  const [sale, setSale] = useState<{ id: string; slug: string; title: string; status: string; closesAtMs: number; items: Item[] } | null>(null);
  const [stamps, setStamps] = useState<Record<string, { handle: string; atMs: number }>>({});
  const [selected, setSelected] = useState<string[]>([]); const [handle, setHandle] = useState(""); const [email, setEmail] = useState(""); const [message, setMessage] = useState(""); const [receiptId, setReceiptId] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [demoBuyer, setDemoBuyer] = useState<string | null>(null);
  useEffect(() => { api<Config>("/api/config").then((config) => setDemoBuyer(config.demoBuyerEmail)).catch(() => setDemoBuyer(null)); }, []);
  const load = useCallback(async () => { try { setSale(await api(`/api/public/sales/${slug}`)); } catch (err) { setError(err instanceof Error ? err.message : "Sale could not load"); } }, [slug]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!sale) return; const events = new EventSource(`/api/events?saleId=${encodeURIComponent(sale.id)}`); eventTypes.forEach((type) => events.addEventListener(type, (event) => { if (type === "claim_received" || type === "backup_queued") { const entry = JSON.parse((event as MessageEvent).data) as { item_id: string; at_ms: number; payload: { handle: string; atMs: number } }; setStamps((current) => ({ ...current, [entry.item_id]: { handle: entry.payload.handle, atMs: entry.payload.atMs ?? entry.at_ms } })); } void load(); })); return () => events.close(); }, [sale?.id, load]);
  const chosen = (sale?.items ?? []).filter((item) => selected.includes(item.id));
  async function claim() {
    if (!sale) return; setBusy(true); setError(""); setMessage("");
    try { const result = await api<{ claims: Array<{ kind: string; itemId: string; atMs: number }>; invoices: Array<{ id: string; payer_url: string | null }> }>(`/api/sales/${sale.id}/claims`, { method: "POST", body: JSON.stringify({ handle, email, itemIds: selected }) }); const backups = result.claims.filter((claim) => claim.kind === "backup"); setStamps((current) => ({ ...current, ...Object.fromEntries(result.claims.map((claim) => [claim.itemId, { handle, atMs: claim.atMs }])) })); setReceiptId(result.invoices[0]?.id ?? ""); setMessage(backups.length ? `Claim received. Backup position ${Math.max(...backups.map((claim) => (sale.items.find((item) => item.id === claim.itemId)?.backupCount ?? 0) + 1))}. Timestamp ${time(result.claims[0]?.atMs ?? Date.now())}.` : `Claim received at ${time(result.claims[0]?.atMs ?? Date.now())}. The server timestamp is the judge.`); setSelected([]); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Claim could not be placed"); }
    finally { setBusy(false); }
  }
  if (!sale) return <Shell buyer><main className="buyer-page"><p className="error-message">{error || "Loading sale…"}</p></main></Shell>;
  return <Shell buyer><main className="buyer-page"><div className="buyer-title"><div><p className="eyebrow">OPEN BINDER / {sale.items.length} POCKETS</p><h1>{sale.title}</h1></div><div className="sale-clock"><span className="live-dot"/>{sale.status === "CLOSED" ? "SALE CLOSED" : "CLAIMS OPEN"}<small>Until {dateTime(sale.closesAtMs)}</small></div></div><div className="buyer-rules"><span><ShieldCheck size={15}/> PayPal Goods &amp; Services invoices</span><span><Clock3 size={15}/> Server timestamp decides order</span><span><CircleHelp size={15}/> Backups keep their place</span></div><section className="pocket-grid" aria-label="Sale items">{sale.items.map((item) => { const isSelected = selected.includes(item.id); const available = item.status === "OPEN" || item.status === "CLAIMED"; const stamp = stamps[item.id]; return <button type="button" className={`pocket ${item.status !== "OPEN" ? "pocket-taken" : ""} ${isSelected ? "pocket-selected" : ""}`} key={item.id} onClick={() => available && setSelected((current) => isSelected ? current.filter((id) => id !== item.id) : [...current, item.id])} aria-pressed={isSelected} disabled={!available || sale.status === "CLOSED"}><span className="pocket-number">#{String(item.number).padStart(2, "0")}</span><span className="pocket-art" aria-hidden="true"/><span className="pocket-info"><strong>{item.title}</strong>{(item.setOrPlatform || item.conditionNotes) && <small>{[item.setOrPlatform, item.conditionNotes].filter(Boolean).join(" · ")}</small>}<b>{money(item.priceCents)}</b>{item.status === "OPEN" ? <small>{isSelected ? "Selected" : "Tap to claim"}</small> : <><span className="claimed-stamp">{stamp ? `@${stamp.handle} · ${time(stamp.atMs)}` : `${item.status}${item.backupCount ? ` · ${item.backupCount} backup${item.backupCount === 1 ? "" : "s"}` : ""}`}</span>{item.status === "CLAIMED" && <small>{isSelected ? "Backup selected" : "Select to back up"}</small>}</>}</span></button>; })}</section>
    {error && <p className="error-message" role="alert">{error}</p>}{message && <p className="success-message" role="status"><Check size={17}/>{message}{receiptId && <Link to={`/receipt/${receiptId}`}>View receipt</Link>}</p>}
    {selected.length > 0 && <form className="claim-panel" onSubmit={(event) => { event.preventDefault(); void claim(); }}><div className="claim-panel-summary"><span className="eyebrow">YOUR CLAIM</span><strong>{selected.map((id) => `#${String(sale.items.find((item) => item.id === id)?.number).padStart(2, "0")}`).join(" · ")}</strong><small>{money(chosen.reduce((sum, item) => sum + (item.priceCents ?? 0), 0))} before shipping</small></div><Field label="Social handle"><input required maxLength={80} value={handle} onChange={(e) => setHandle(e.target.value.replace(/^@/, ""))} placeholder="@yourhandle"/></Field><Field label="Email for invoice" hint={demoBuyer ? `PayPal sandbox buyer: ${demoBuyer}` : undefined}><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"/></Field><button className="button button-primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : null}{chosen.some((item) => item.status === "CLAIMED") ? "Back me up" : `Claim ${selected.map((id) => `#${String(sale.items.find((item) => item.id === id)?.number).padStart(2, "0")}`).join(", ")}`}</button></form>}
    <p className="buyer-footnote">Claiming an item means you agree to the seller’s sale rules. If it’s already taken, you can join the backup queue.</p></main></Shell>;
}

function ImportPage() {
  usePageTitle("Review imported comments");
  const { saleId = "" } = useParams(); const key = ownerKey(saleId);
  const [text, setText] = useState(""); const [rows, setRows] = useState<ImportEvent[]>([]); const [items, setItems] = useState<Item[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const navigate = useNavigate();
  const claimRows = rows.filter((row) => row.kind === "claim" || row.kind === "backup");
  const canConfirm = claimRows.length > 0 && claimRows.every((row) => row.email.trim() && row.itemIds.length > 0 && row.itemIds.every(Boolean));
  useEffect(() => { api<{ items: Item[] }>(`/api/sales/${saleId}`, {}, key).then((result) => setItems(result.items)).catch((err) => setError(err.message)); }, [saleId, key]);
  async function preview() { setBusy(true); setError(""); try { const result = await api<{ events: ImportEvent[] }>(`/api/sales/${saleId}/import/preview`, { method: "POST", body: JSON.stringify({ text }) }, key); setRows(result.events.map((row) => ({ ...row, itemIds: row.resolutions.map((resolution) => resolution.status === "matched" ? resolution.itemId ?? "" : "") }))); } catch (err) { setError(err instanceof Error ? err.message : "Could not parse comments"); } finally { setBusy(false); } }
  async function confirm() { if (!canConfirm) { setError("Add an item match and buyer email to every claim row before confirming."); return; } setBusy(true); setError(""); try { await api(`/api/sales/${saleId}/import/confirm`, { method: "POST", body: JSON.stringify({ events: claimRows.map((row) => ({ handle: row.handle, email: row.email.trim(), raw: row.raw, kind: row.kind, itemIds: row.itemIds, atMs: row.atMs })) }) }, key); navigate(`/dash/${saleId}`); } catch (err) { setError(err instanceof Error ? err.message : "Could not confirm claims"); } finally { setBusy(false); } }
  return <Shell><main className="page import-page"><div className="page-kicker"><span>SELLER / COMMENT IMPORT</span><Link to={`/dash/${saleId}`}>Back to docket</Link></div><p className="eyebrow">PASTE, MATCH, CONFIRM</p><h1>Bring the thread<br/>into the queue.</h1><p className="lede">Paste copied replies from X, Instagram, or Discord. Every row stays linked to the original comment for review.</p><Field label="Copied comment thread"><textarea rows={9} maxLength={150000} value={text} onChange={(e) => setText(e.target.value)} placeholder="@mika · 2m\nMine 3 and the Charizard\n\n@jules · 11:42 PM\nbackup #3"/></Field><div className="section-foot"><span>{text.length.toLocaleString()} / 150,000 characters</span><button className="button button-primary" disabled={!text.trim() || busy} onClick={() => void preview()}>{busy ? <LoaderCircle className="spin" size={16}/> : null}Parse comments <ChevronRight size={16}/></button></div>
    {rows.length > 0 && <><div className="import-table-wrap"><table className="import-table"><thead><tr><th>ORDER</th><th>HANDLE / TIME</th><th>RAW COMMENT</th><th>TYPE</th><th>MATCHED ITEMS</th><th>BUYER EMAIL</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.pasteOrder}-${index}`} className={row.needsSeller ? "needs-review" : ""}><td className="cell-mono">{String(row.pasteOrder).padStart(2, "0")}</td><td><strong>@{row.handle}</strong><small>{dateTime(row.atMs)}</small></td><td>{row.raw}</td><td><select aria-label={`Kind for row ${index + 1}`} value={row.kind} onChange={(e) => setRows((current) => current.map((entry, i) => i === index ? { ...entry, kind: e.target.value as ImportEvent["kind"] } : entry))}><option value="claim">Claim</option><option value="backup">Backup</option><option value="question">Question</option><option value="other">Other</option></select></td><td><span className="match-list">{(row.resolutions.length ? row.resolutions : row.kind === "claim" ? [{ ref: "Select item", status: "needs_seller" }] : []).map((resolution, j) => <label className="resolution-edit" key={j}><small>{resolution.ref}</small><select aria-label={`Item match for ${row.handle}, reference ${resolution.ref}`} value={row.itemIds[j] ?? ""} onChange={(e) => setRows((current) => current.map((entry, i) => { if (i !== index) return entry; const itemIds = [...entry.itemIds]; itemIds[j] = e.target.value; return { ...entry, itemIds, needsSeller: itemIds.some((value) => !value) }; }))}><option value="">Choose item</option>{items.map((item) => <option key={item.id} value={item.id}>#{String(item.number).padStart(2, "0")} {item.title}</option>)}</select></label>)}</span><button className="add-match" type="button" onClick={() => setRows((current) => current.map((entry, i) => i === index ? { ...entry, itemIds: [...entry.itemIds, ""], resolutions: [...entry.resolutions, { ref: "Extra item", status: "needs_seller" }], needsSeller: true } : entry))}>Add item</button></td><td><input aria-label={`Email for ${row.handle}`} type="email" placeholder="required for invoicing" value={row.email} onChange={(e) => setRows((current) => current.map((entry, i) => i === index ? { ...entry, email: e.target.value } : entry))}/></td></tr>)}</tbody></table></div><div className="section-foot"><span>{rows.filter((row) => (row.kind === "claim" || row.kind === "backup") && (!row.itemIds.some(Boolean) || !row.email)).length} claim rows need review</span><button className="button button-primary" disabled={busy || !canConfirm} onClick={() => void confirm()}>{busy ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>}Confirm reviewed claims</button></div></>}
    {error && <p className="error-message" role="alert">{error}</p>}</main></Shell>;
}

function Receipt() {
  usePageTitle("Buyer receipt"); const { id = "" } = useParams();
  const [data, setData] = useState<{ invoice: { id: string; buyerHandle: string; status: string; subtotalCents: number; shippingCents: number; feeCents: number; totalCents: number; payerUrl: string | null }; items: Array<{ number: number; title: string; price_cents: number }>; shipment?: { carrier: string; tracking: string } } | null>(null);
  const [error, setError] = useState(""); useEffect(() => { api<typeof data>(`/api/receipts/${id}`).then(setData).catch((err) => setError(err.message)); }, [id]);
  if (!data) return <Shell buyer><main className="receipt-page"><p className="error-message">{error || "Loading receipt…"}</p></main></Shell>;
  return <Shell buyer><main className="receipt-page"><div className="receipt-stamp"><Check size={17}/> DIBS RECEIPT / {data.invoice.status}</div><h1>Thanks, @{data.invoice.buyerHandle}.</h1><p className="lede">Your items and payment details, in one place.</p><section className="receipt-paper"><div className="receipt-items">{data.items.map((item) => <div className="receipt-item" key={item.number}><span>#{String(item.number).padStart(2, "0")}</span><strong>{item.title}</strong><b className="numeric">{money(item.price_cents)}</b></div>)}</div><div className="receipt-totals"><span>Items <b>{money(data.invoice.subtotalCents)}</b></span><span>Shipping <b>{money(data.invoice.shippingCents)}</b></span>{data.invoice.feeCents > 0 && <span>Fee <b>{money(data.invoice.feeCents)}</b></span>}<span className="receipt-total">Total <b>{money(data.invoice.totalCents)}</b></span></div>{data.shipment && <div className="tracking-box"><span className="eyebrow">ON THE WAY</span><strong>{data.shipment.carrier}</strong><code>{data.shipment.tracking}</code></div>}</section>{data.invoice.status !== "PAID" && data.invoice.payerUrl && <a className="button button-primary receipt-pay" href={data.invoice.payerUrl} target="_blank" rel="noreferrer">Pay with PayPal <ArrowUpRight size={16}/></a>}<p className="receipt-note"><ShieldCheck size={15}/> Payment is handled by PayPal Goods &amp; Services.</p></main></Shell>;
}

function SetupPage() {
  usePageTitle("Setup"); const [config, setConfig] = useState<Config | null>(null); const [health, setHealth] = useState<{ ok: boolean; missing: string[] } | null>(null);
  useEffect(() => { Promise.all([api<Config>("/api/config"), api<{ ok: boolean; missing: string[] }>("/api/health")]).then(([c, h]) => { setConfig(c); setHealth(h); }).catch(() => setHealth({ ok: false, missing: ["API server"] })); }, []);
  return <Shell><main className="page setup-page"><p className="eyebrow">CONNECTIONS / STATUS</p><h1>Ready when<br/>the keys are.</h1><p className="lede">Dibs starts without credentials. Add the services you need to itemize photos and send protected invoices.</p><section className="setup-list">{[["OpenRouter", "OPENROUTER_API_KEY", "Photo itemization and comment import"], ["PayPal", "PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET", "Protected invoices, reminders, and payment status"], ["Webhook", "PAYPAL_WEBHOOK_ID", "Optional real-time invoice updates"], ["Buyer account", "DEMO_BUYER_EMAIL", "Optional sandbox buyer email shown to judges"]].map(([name, env, purpose]) => <div className="setup-row" key={name}><span className={`setup-state ${config?.missing.some((entry) => env.includes(entry)) ? "setup-missing" : ""}`}>{config?.missing.some((entry) => env.includes(entry)) ? "NEEDS KEY" : "OPTIONAL"}</span><div><h2>{name}</h2><code>{env}</code><p>{purpose}</p>{env === "DEMO_BUYER_EMAIL" && config?.demoBuyerEmail && <p>Sandbox buyer: <code>{config.demoBuyerEmail}</code></p>}</div><ChevronRight size={17}/></div>)}</section>{health && <p className={`health-line ${health.ok ? "health-ok" : "error-message"}`}><Radio size={15}/>{health.ok ? "API is responding" : "API is unavailable"}{health.missing.length ? ` · Missing: ${health.missing.join(", ")}` : ""}</p>}<p className="setup-footnote">Add keys to the server environment and restart it. Secret values are never shown here.</p></main></Shell>;
}

function NotFound() { usePageTitle("Page not found"); return <Shell><main className="page"><p className="eyebrow">404 / POCKET NOT FOUND</p><h1>This page isn’t in the binder.</h1><Link className="button button-primary" to="/">Start a sale</Link></main></Shell>; }

function App() { return <BrowserRouter><Routes><Route path="/" element={<CreateSale/>}/><Route path="/s/:slug" element={<SalePage/>}/><Route path="/dash/:saleId" element={<Dashboard/>}/><Route path="/import/:saleId" element={<ImportPage/>}/><Route path="/receipt/:id" element={<Receipt/>}/><Route path="/setup" element={<SetupPage/>}/><Route path="*" element={<NotFound/>}/></Routes></BrowserRouter>; }

createRoot(document.getElementById("root")!).render(<StrictMode><App/></StrictMode>);
