import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AgGridReact } from "ag-grid-react";
import { themeQuartz, type ColDef, type ColGroupDef, type GetRowIdParams, type GridReadyEvent, type ICellRendererParams, type IRowNode, type ITooltipParams, type SelectionChangedEvent } from "ag-grid-community";
import { ArrowUp, BellRing, Download, RotateCcw, ShieldCheck, X } from "lucide-react";
import { at, money } from "./format.ts";
import { SOLD_STATUSES, soldAnnouncement, soldTransitions } from "./live-status.ts";

/* Minimal shapes the docket needs; main.tsx passes its richer records straight through. */
type Comps = { status: "ok" | "none" | "error"; count?: number; medianCents?: number; sources?: Array<{ domain: string; priceCents: number }> } | null | undefined;
type DItem = { id: string; number: number; title: string; status?: string; price_cents?: number | null; comps?: Comps; photoUrl?: string | null };
type DClaim = { item_id: string; handle: string; email: string; at_ms: number; kind: string };
type DInvoice = { id: string; buyer_handle: string; buyer_email: string; status: string; subtotal_cents: number; shipping_cents: number; fee_cents: number; total_cents: number; due_at_ms: number; paypal_invoice_id?: string | null; payer_url: string | null; deposit_cents?: number | null; items: Array<{ id: string }>; shipment?: { carrier: string; tracking: string; paypal_tracker_id?: string | null } };
type DEvent = { type: string; at_ms: number; item_id?: string | null };
export type DocketData = { items: DItem[]; claims: DClaim[]; invoices: DInvoice[]; events: DEvent[] };

export type DocketRow = {
  id: string; number: string; photo: string; title: string; comps: Comps; buyer: string; email: string; claimed: string; claimedMs: number | null; backup: number;
  queue: string[]; rolledFrom: string | null; subtotal: number; shipping: number; fee: number; total: number; status: string; due?: number; invoice?: DInvoice; item: DItem;
};

const UNPAID = new Set(["INVOICED", "SENT", "UNPAID", "DRAFT", "HELD"]);
const PAID = new Set(["PAID", "MARKED_AS_PAID", "SHIPPED"]);
const clock = (ms: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(ms);
const COLS_KEY = "dibs-docket-columns:v1";

function useNarrow(query = "(max-width: 700px)") {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => { const media = window.matchMedia?.(query); if (!media) return; const on = () => setNarrow(media.matches); media.addEventListener("change", on); return () => media.removeEventListener("change", on); }, [query]);
  return narrow;
}

export function buildDocketRows(data: DocketData): DocketRow[] {
  return data.items.map((item) => {
    const itemInvoices = data.invoices.filter((record) => record.items.some((part) => part.id === item.id));
    // A claimant whose invoice for this item was cancelled has been passed over (matched by handle).
    const cancelled = itemInvoices.filter((record) => record.status === "CANCELLED");
    const passed = new Set(cancelled.map((record) => record.buyer_handle.toLowerCase()));
    const itemClaims = data.claims.filter((claim) => claim.item_id === item.id && !passed.has(claim.handle.toLowerCase()));
    const first = itemClaims[0];
    const invoice = itemInvoices.find((record) => record.status !== "CANCELLED");
    return {
      id: item.id, number: `#${String(item.number).padStart(2, "0")}`, photo: "", title: item.title, comps: item.comps ?? null,
      buyer: first?.handle ? at(first.handle) : "", email: first?.email ?? "", claimed: first?.at_ms ? clock(first.at_ms) : "", claimedMs: first?.at_ms ?? null,
      backup: Math.max(0, itemClaims.length - 1), queue: itemClaims.slice(1).map((claim) => `${at(claim.handle)} · ${clock(claim.at_ms)}`),
      rolledFrom: first && cancelled.length ? at(cancelled[0].buyer_handle) : null,
      subtotal: item.price_cents ?? 0, shipping: invoice?.shipping_cents ?? 0, fee: invoice?.fee_cents ?? 0, total: invoice?.total_cents ?? 0,
      status: invoice?.status === "HELD" ? "HELD" : item.status ?? "OPEN", due: invoice?.due_at_ms, invoice, item,
    };
  });
}

export function docketTotals(invoices: DInvoice[]) {
  return invoices.filter((invoice) => invoice.status !== "CANCELLED").reduce((sum, invoice) => ({ subtotal: sum.subtotal + invoice.subtotal_cents, shipping: sum.shipping + invoice.shipping_cents, fee: sum.fee + invoice.fee_cents, total: sum.total + invoice.total_cents }), { subtotal: 0, shipping: 0, fee: 0, total: 0 });
}

export function buyersToInvoice(rows: DocketRow[]): number {
  // Same set close-and-invoice bills: claimed items with no live invoice. Sent, paid or held rows already have one.
  return new Set(rows.filter((row) => row.buyer && row.status === "CLAIMED" && !row.invoice).map((row) => row.buyer.toLowerCase())).size;
}

// Dibs paper-binder theme on the AG Grid Theming API (community).
export const docketTheme = themeQuartz.withParams({
  accentColor: "#d7261e", backgroundColor: "#fffefa", foregroundColor: "#111111", chromeBackgroundColor: "#eeeae1",
  headerBackgroundColor: "#eeeae1", headerTextColor: "#5e636c", headerFontWeight: 600, headerFontSize: 10.5,
  borderColor: "#d8d2c7", rowBorder: { color: "#e4dfd6" }, rowHoverColor: "#f5f1e9", selectedRowBackgroundColor: "#fbecea",
  oddRowBackgroundColor: "#fffefa", fontFamily: "'Onest', sans-serif", fontSize: 13, rowHeight: 52, headerHeight: 38,
  spacing: 7, wrapperBorderRadius: 0, borderRadius: 2, checkboxBorderRadius: 2, checkboxCheckedBackgroundColor: "#111111",
  checkboxCheckedBorderColor: "#111111", inputFocusBorder: { color: "#154e75" }, browserColorScheme: "light",
});

type Filter = "all" | "open" | "claimed" | "unpaid" | "paid" | "rolled";
const FILTERS: Array<[Filter, string, (row: DocketRow) => boolean]> = [
  ["all", "All", () => true],
  ["open", "Open", (row) => row.status === "OPEN"],
  ["claimed", "Claimed", (row) => row.status === "CLAIMED"],
  ["unpaid", "Awaiting payment", (row) => UNPAID.has(row.status)],
  ["paid", "Paid / shipped", (row) => PAID.has(row.status)],
  ["rolled", "Rolled to backup", (row) => !!row.rolledFrom],
];

export function DocketKpis({ data, rows }: { data: DocketData; rows: DocketRow[] }) {
  const live = data.invoices.filter((invoice) => invoice.status !== "CANCELLED");
  const sum = (list: DInvoice[]) => list.reduce((total, invoice) => total + invoice.total_cents, 0);
  const collected = sum(live.filter((invoice) => PAID.has(invoice.status)));
  const outstanding = sum(live.filter((invoice) => UNPAID.has(invoice.status)));
  const fees = live.reduce((total, invoice) => total + invoice.fee_cents, 0);
  const rollovers = data.events.filter((event) => event.type === "backup_promoted").length;
  const open = rows.filter((row) => row.status === "OPEN").length;
  return <dl className="docket-kpis">
    <div className="kpi-lead"><dt>Collected on PayPal</dt><dd className="numeric">{money(collected)}</dd></div>
    <div><dt>Awaiting payment</dt><dd className="numeric">{money(outstanding)}</dd></div>
    <div><dt>G&amp;S fee lines</dt><dd className="numeric">{money(fees)}</dd></div>
    <div><dt>Rolled to backup</dt><dd className="numeric">{rollovers}</dd></div>
    <div><dt>Pockets still open</dt><dd className="numeric">{open} / {rows.length}</dd></div>
  </dl>;
}

export function DocketGrid({ data, compsReady, live, renderPhoto, renderStatus, renderDue, onRemind, onPass, onShip }: {
  data: DocketData; compsReady: boolean; live: boolean;
  renderPhoto: (item: DItem) => ReactNode; renderStatus: (value: string) => ReactNode; renderDue: (due: number) => ReactNode;
  onRemind: (invoiceIds: string[]) => void; onPass: (invoiceId: string) => void; onShip: (invoice: DInvoice) => void;
}) {
  const grid = useRef<AgGridReact<DocketRow>>(null);
  const [quick, setQuick] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<DocketRow[]>([]);
  const rows = useMemo(() => buildDocketRows(data), [data]);
  const filterRef = useRef<Filter>("all"); filterRef.current = filter;

  // Live sale: when a row flips to paid (SSE invoice_paid → reload), flash the whole row and announce the sale.
  const previousStatus = useRef<Map<string, string> | null>(null);
  const soldTimer = useRef<number | undefined>(undefined);
  const [soldNote, setSoldNote] = useState<string | null>(null);
  useEffect(() => {
    const changes = soldTransitions(previousStatus.current, rows);
    previousStatus.current = new Map(rows.map((row) => [row.id, row.status]));
    if (!changes.length) return;
    setSoldNote(soldAnnouncement(changes));
    window.clearTimeout(soldTimer.current);
    soldTimer.current = window.setTimeout(() => setSoldNote(null), 8000);
    const flash = window.setTimeout(() => {
      const api = grid.current?.api;
      const nodes = changes.map((change) => api?.getRowNode(change.id)).filter((node): node is IRowNode<DocketRow> => !!node);
      if (api && nodes.length) api.flashCells({ rowNodes: nodes, flashDuration: 1600, fadeDuration: 1400 });
    }, 60);
    return () => window.clearTimeout(flash);
  }, [rows]);

  const totals = useMemo(() => docketTotals(data.invoices), [data]);
  const pinnedBottomRowData = useMemo(() => [{ id: "totals", number: "TOTALS", title: "Invoice totals", buyer: "", claimed: "", backup: null, status: "", due: "", ...totals }], [totals]);
  const hideComps = !compsReady;
  const narrow = useNarrow();

  const columnDefs = useMemo<Array<ColDef<DocketRow> | ColGroupDef<DocketRow>>>(() => [
    { headerName: "Item", marryChildren: true, children: [
      { field: "number", headerName: "#", width: 62, filter: false, cellClass: "cell-mono cell-number" },
      { field: "photo", headerName: "Photo", width: 72, sortable: false, filter: false, cellClass: "cell-photo", cellRenderer: (p: ICellRendererParams<DocketRow>) => p.data?.item ? renderPhoto(p.data.item) : "" },
      { field: "title", headerName: "Name", minWidth: 150, flex: 1, wrapText: true, autoHeight: true, cellClass: "cell-name", filter: "agTextColumnFilter", floatingFilter: true, tooltipField: "title" },
      { field: "comps", headerName: "Comps", width: 100, hide: hideComps, filter: false, comparator: (a: Comps, b: Comps) => (a?.medianCents ?? -1) - (b?.medianCents ?? -1),
        tooltipValueGetter: (p: ITooltipParams<DocketRow>) => p.data?.comps?.status === "ok" ? p.data.comps.sources?.map((s) => `${s.domain} ${money(s.priceCents)}`).join("\n") : undefined,
        cellRenderer: (p: ICellRendererParams<DocketRow>) => !p.data?.item ? "" : !p.value ? <span className="cell-muted">Not checked</span> : p.value.status === "ok" ? <span className="cell-comps">{money(p.value.medianCents)}<small>{p.value.count} on Channel3</small></span> : <span className="cell-muted">{p.value.status === "none" ? "No comps" : "Unavailable"}</span> },
    ] },
    { headerName: "Claim", marryChildren: true, children: [
      { field: "buyer", headerName: "Buyer", width: 170, filter: "agTextColumnFilter", floatingFilter: true,
        tooltipValueGetter: (p: ITooltipParams<DocketRow>) => p.data?.rolledFrom ? `Moved up from backup after ${p.data.rolledFrom} passed` : p.data?.email || undefined,
        cellRenderer: (p: ICellRendererParams<DocketRow>) => p.value ? <span className="cell-buyer"><span>{p.value}</span>{p.data?.rolledFrom && <span className="rolled-tag" aria-label={`Moved up from backup after ${p.data.rolledFrom} passed`}><ArrowUp size={10} strokeWidth={3} aria-hidden="true"/></span>}</span> : "" },
      { field: "claimed", headerName: "Claimed", width: 80, cellClass: "cell-mono", filter: false, comparator: (_a, _b, na: IRowNode<DocketRow>, nb: IRowNode<DocketRow>) => (na.data?.claimedMs ?? 0) - (nb.data?.claimedMs ?? 0) },
      { field: "backup", headerName: "Backup", width: 70, filter: false,
        tooltipValueGetter: (p: ITooltipParams<DocketRow>) => p.data?.queue?.length ? `Backup line:\n${p.data.queue.join("\n")}` : undefined,
        cellRenderer: (p: ICellRendererParams<DocketRow>) => p.value == null ? "" : <span className={p.value > 0 ? "backup-pill" : "backup-zero"}>{p.value}</span> },
    ] },
    { headerName: "Invoice", marryChildren: true, children: [
      { field: "status", headerName: "Status", width: 118, filter: false, cellRenderer: (p: ICellRendererParams<DocketRow>) => p.value ? renderStatus(p.value) : null,
        tooltipValueGetter: (p: ITooltipParams<DocketRow>) => p.data?.invoice?.paypal_invoice_id ? `PayPal ${p.data.invoice.paypal_invoice_id}` : undefined },
      { field: "due", headerName: "Due", width: 72, filter: false, cellRenderer: (p: ICellRendererParams<DocketRow>) => p.value && p.data && UNPAID.has(p.data.status) ? renderDue(p.value) : "" },
      { field: "subtotal", headerName: "Items", width: 80, filter: "agNumberColumnFilter", valueFormatter: (p) => money(p.value), cellClass: "cell-money" },
      { field: "shipping", headerName: "Ship", width: 62, filter: false, valueFormatter: (p) => money(p.value), cellClass: "cell-money" },
      { field: "fee", headerName: "Fee", width: 62, filter: false, valueFormatter: (p) => money(p.value), cellClass: "cell-money" },
      { field: "total", headerName: "Total", width: 84, filter: "agNumberColumnFilter", valueFormatter: (p) => money(p.value), cellClass: "cell-money cell-total" },
    ] },
    { colId: "actions", headerName: "Actions", width: 118, suppressSpanHeaderHeight: true, pinned: narrow ? null : "right", sortable: false, filter: false, resizable: false, cellRenderer: (p: ICellRendererParams<DocketRow>) => {
      const invoice = p.data?.invoice; if (!invoice) return "";
      if (invoice.shipment?.paypal_tracker_id) return <span className="on-paypal" title={`PayPal tracker ${invoice.shipment.paypal_tracker_id}`}><ShieldCheck size={13}/>On PayPal</span>;
      if (PAID.has(p.data!.status)) return <div className="row-actions"><button onClick={() => onShip(invoice)}>Add tracking</button></div>;
      return <div className="row-actions"><button onClick={() => onRemind([invoice.id])}>Remind</button><button onClick={() => onPass(invoice.id)} title="Cancel this invoice and roll the item to the next backup">Pass</button></div>;
    } },
  ], [hideComps, narrow, renderPhoto, renderStatus, renderDue, onRemind, onPass, onShip]);

  const saveColumns = useCallback(() => { const api = grid.current?.api; if (api) localStorage.setItem(COLS_KEY, JSON.stringify(api.getColumnState())); }, []);
  const onGridReady = useCallback((event: GridReadyEvent<DocketRow>) => {
    try { const saved = localStorage.getItem(COLS_KEY); if (saved) event.api.applyColumnState({ state: JSON.parse(saved), applyOrder: true }); } catch { localStorage.removeItem(COLS_KEY); }
  }, []);
  const resetColumns = () => { localStorage.removeItem(COLS_KEY); grid.current?.api.resetColumnState(); };
  const exportCsv = (onlySelected: boolean) => grid.current?.api.exportDataAsCsv({
    fileName: `dibs-docket-${new Date().toISOString().slice(0, 10)}.csv`, onlySelected,
    columnKeys: ["number", "title", "buyer", "claimed", "backup", "status", "subtotal", "shipping", "fee", "total"],
    processCellCallback: (p) => ["subtotal", "shipping", "fee", "total"].includes(p.column.getColId()) ? ((Number(p.value) || 0) / 100).toFixed(2) : p.value ?? "",
  });
  const setStatusFilter = (next: Filter) => { setFilter(next); filterRef.current = next; grid.current?.api.onFilterChanged(); };
  const remindable = [...new Map(selected.filter((row) => row.invoice && ["SENT", "UNPAID"].includes(row.invoice.status)).map((row) => [row.invoice!.id, row.invoice!.id])).values()];

  return <>
    <div className="grid-toolbar docket-toolbar">
      <div className="docket-toolbar-title"><span className={`live-dot ${live ? "live-dot-pulse" : "live-dot-off"}`}/> LIVE CLAIM REGISTER <span className="grid-count">{rows.length} pockets / {data.claims.length} claim events</span></div>
      <div className="docket-toolbar-tools">
        <label className="quick-filter"><span className="sr-only">Filter rows</span><input aria-label="Filter sale rows" type="search" placeholder="Search name, buyer, status…" value={quick} onChange={(e) => setQuick(e.target.value)}/></label>
        <button type="button" className="tool-button" onClick={() => exportCsv(false)}><Download size={13} aria-hidden="true"/>CSV</button>
        <button type="button" className="tool-button" onClick={resetColumns} title="Reset column order, widths and sort"><RotateCcw size={13} aria-hidden="true"/>Columns</button>
      </div>
    </div>
    <div className="docket-filters" role="toolbar" aria-label="Filter by status">{FILTERS.map(([key, label, test]) => <button type="button" key={key} aria-pressed={filter === key} className={`filter-chip ${filter === key ? "is-on" : ""} ${key === "rolled" ? "filter-chip-rolled" : ""}`} onClick={() => setStatusFilter(key)}>{label}<b>{rows.filter(test).length}</b></button>)}</div>
    {selected.length > 0 && <div className="bulk-bar" role="region" aria-label="Bulk actions"><strong>{selected.length} selected</strong><button type="button" className="tool-button tool-button-dark" disabled={!remindable.length} onClick={() => onRemind(remindable)}><BellRing size={13} aria-hidden="true"/>Remind {remindable.length} unpaid</button><button type="button" className="tool-button" onClick={() => exportCsv(true)}><Download size={13} aria-hidden="true"/>Export selected</button><button type="button" className="tool-button tool-button-plain" onClick={() => grid.current?.api.deselectAll()}><X size={13} aria-hidden="true"/>Clear</button></div>}
    <p className={`sold-note ${soldNote ? "is-on" : ""}`} role="status" aria-live="polite">{soldNote ? <><ShieldCheck size={14} aria-hidden="true"/><span>Paid on PayPal: {soldNote}</span></> : null}</p>
    <div className="grid-wrap docket-grid">
      <AgGridReact<DocketRow> ref={grid} theme={docketTheme} rowData={rows} columnDefs={columnDefs} getRowId={(p: GetRowIdParams<DocketRow>) => p.data.id}
        defaultColDef={{ sortable: true, resizable: true, filter: true, suppressHeaderMenuButton: true, enableCellChangeFlash: true }}
        rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true, enableClickSelection: false }} selectionColumnDef={{ width: 44, pinned: narrow ? null : "left", resizable: false }}
        onSelectionChanged={(event: SelectionChangedEvent<DocketRow>) => setSelected(event.api.getSelectedRows())}
        isExternalFilterPresent={() => filterRef.current !== "all"} doesExternalFilterPass={(node) => !!node.data && FILTERS.find(([key]) => key === filterRef.current)![2](node.data)}
        rowClassRules={{ "row-sold": (p) => !!p.data && SOLD_STATUSES.has(p.data.status), "row-rolled": (p) => !!p.data?.rolledFrom, "row-due-soon": (p) => !!p.data?.due && UNPAID.has(p.data.status) && p.data.due - Date.now() < 3_600_000 }}
        rowHeight={52} headerHeight={38} floatingFiltersHeight={34} domLayout="autoHeight" quickFilterText={quick} pinnedBottomRowData={pinnedBottomRowData}
        animateRows tooltipShowDelay={250} tooltipInteraction={false} suppressDragLeaveHidesColumns
        onColumnMoved={saveColumns} onColumnResized={(e) => e.finished && saveColumns()} onSortChanged={saveColumns} onColumnVisible={saveColumns} onGridReady={onGridReady}
        suppressNoRowsOverlay />
      {!rows.length && <p className="grid-empty-state">No pockets yet. Add items from the new-sale page and publish to start the register.</p>}
    </div>
    <p className="grid-hint">Tip: tick rows to remind or export in bulk · drag headers to reorder (saved on this device) · hover Backup for the queue.</p>
  </>;
}
